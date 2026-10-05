# Agent Pipeline — AWS Infrastructure (Terraform)

Illustrative, **reviewable** Infrastructure-as-Code that describes a deployable
AWS shape for the `agent-pipeline` app on **ECS Fargate**.

> **This IaC is intentionally NOT applied.** It exists so reviewers can see how
> the system *would* be deployed. It is self-contained (no external/registry
> modules) and is written to pass `terraform validate` with **AWS provider v5**.
> Applying it would create billable resources (ECS, RDS, ALB, NAT-free public
> Fargate, CloudWatch, Secrets Manager) — **costs apply if you apply it.**

## What it provisions

| Service | Image | Port | Notes |
| --- | --- | --- | --- |
| `temporal` | `temporalio/auto-setup:1.29.1` | 7233 (gRPC) | Self-hosted Temporal, auto-creates schema, backed by RDS Postgres. |
| `temporal-ui` | `temporalio/ui:2.34.0` | 8080 | Web UI; reaches the server over Cloud Map DNS. |
| `worker` | your ECR image | — (no inbound) | Runs the Temporal worker. |
| `api` | your ECR image | 3001 | Express API + React SPA; **public via the ALB**. |

Supporting resources: a Fargate **cluster**, **Cloud Map** private DNS
(`agent-pipeline.local`) for service discovery, an internet-facing **ALB**,
**ECR** repos (api, worker), a dev-sized **RDS Postgres 16**, **Secrets
Manager** (one JSON secret), **IAM** roles, and **CloudWatch** log groups.

Service-to-service DNS goes through Cloud Map, so the worker/api/UI reach the
server at **`temporal.agent-pipeline.local:7233`**.

## Files

| File | Contents |
| --- | --- |
| `versions.tf` | Terraform + AWS provider v5 constraints, provider config, default tags. |
| `variables.tf` | All inputs; secrets marked `sensitive`, default `""`. |
| `network.tf` | Default-VPC data sources + `alb`/`ecs`/`rds` security groups. |
| `ecr.tf` | ECR repos for api + worker (scan-on-push). |
| `rds.tf` | DB subnet group + dev-sized Postgres instance. |
| `secrets.tf` | One Secrets Manager secret (JSON object) + version. |
| `iam.tf` | ECS task execution role (+ secret read) and minimal task role. |
| `logs.tf` | One CloudWatch log group per service (14-day retention). |
| `ecs.tf` | Cloud Map, cluster, 4 task definitions, 4 services. |
| `alb.tf` | ALB, target group (`/api/health`), HTTP:80 listener. |
| `outputs.tf` | ALB URL, ECR repo URLs, RDS endpoint. |
| `terraform.tfvars.example` | Placeholder inputs — copy, fill, **never commit real values**. |

## Prerequisites

- **AWS credentials** with permission to create the above (configured via the
  standard provider chain: `AWS_PROFILE`, env vars, SSO, etc.).
- **Terraform** `>= 1.5` and the **AWS provider v5** (`terraform init` pulls it).
- The first-party **images built and pushed to ECR** (the ECR repos are created
  by this stack, so push after the first apply — see below).

## Usage

```bash
# 1) Initialize providers/backend.
terraform init

# 2) Provide inputs. Either copy the example tfvars...
cp terraform.tfvars.example terraform.tfvars
#    ...and edit it, OR export secrets as environment variables (preferred in CI):
export TF_VAR_db_password='…'
export TF_VAR_google_generative_ai_api_key='…'
export TF_VAR_github_token='…'
# (github_owner/github_repo/trello_* similarly; all optional — see below)

# 3) Review the plan.
terraform plan

# 4) Apply (creates real, billable resources).
terraform apply
```

### Where secrets come from

All sensitive values are **variables** (`sensitive = true`, default `""`). Set
them in `terraform.tfvars` **or** as `TF_VAR_*` environment variables. They are
written into a single Secrets Manager secret (`<project>/app`) as a JSON object,
and each ECS task pulls the individual keys it needs via the task definition's
`secrets` block. **No secret is ever hardcoded in the HCL.** The app degrades
gracefully when an integration's vars are empty, so you can leave the
LLM/GitHub/Trello values blank and still run end-to-end on mocks.

### Build & push the first-party images

The api/worker ECR repos are created by this stack. After the first apply, read
the repo URLs from the outputs and push your tags:

```bash
API_REPO=$(terraform output -raw api_ecr_repository_url)
WORKER_REPO=$(terraform output -raw worker_ecr_repository_url)

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "${API_REPO%/*}"

docker build -t "$API_REPO:latest"    -f packages/api/Dockerfile    .
docker build -t "$WORKER_REPO:latest" -f packages/worker/Dockerfile .
docker push "$API_REPO:latest"
docker push "$WORKER_REPO:latest"
```

Then force a new deployment so the services pick up the images (Temporal needs
~a minute to initialize its schema on first boot — the worker/api/UI retry
their connection until it is ready):

```bash
aws ecs update-service --cluster agent-pipeline --service api    --force-new-deployment
aws ecs update-service --cluster agent-pipeline --service worker --force-new-deployment
```

When it's up, open the app:

```bash
echo "http://$(terraform output -raw alb_dns_name)"
```

## Recommended: use Temporal Cloud instead of self-hosting

Self-hosting Temporal + Postgres (the `temporal`, `temporal-ui`, and `rds`
resources here) is great for a demo but is real operational surface to own. For
production, **[Temporal Cloud](https://temporal.io/cloud) is the recommended
managed alternative**:

- **Drop** the `temporal`, `temporal-ui`, and RDS resources (`rds.tf`, the
  `temporal*` blocks in `ecs.tf`/`logs.tf`, the RDS security group, and the
  `temporal`/`temporal-ui` Cloud Map services).
- **Point** `TEMPORAL_ADDRESS` (used by `worker` and `api`) at your Temporal
  Cloud namespace endpoint (e.g. `<namespace>.<account>.tmprl.cloud:7233`) and
  add the mTLS client cert/key (or API key) Temporal Cloud requires, via
  Secrets Manager.

That removes the database, the schema-init wait, and the self-managed server
entirely, leaving just the `worker` and `api` services plus the ALB.

## Production caveats (this is a demo shape)

- **Default VPC + public subnets.** To stay self-contained, the stack reuses the
  account's **default VPC** and its **public** subnets, and runs Fargate tasks
  with `assign_public_ip = true` so they can pull images without a NAT gateway.
  **Production should use a dedicated VPC with private subnets and NAT gateways
  (or VPC endpoints)**, with RDS and ECS tasks in the private tier.
- **HTTP only.** The ALB listens on `:80`. Add an HTTPS:443 listener with an ACM
  certificate (and HTTP→HTTPS redirect) for production.
- **Dev-sized RDS.** `db.t3.micro`, 20 GB, single-AZ, `skip_final_snapshot =
  true`, no deletion protection. Production should scale up, enable Multi-AZ,
  keep a final snapshot, and turn on deletion protection.
- **Temporal startup.** `depends_on` orders *resource creation*, not in-container
  readiness; Temporal still takes ~a minute to initialize. Clients retry.
- **Costs.** Applying this creates billable resources. Run `terraform destroy`
  to tear it down when you're done.
