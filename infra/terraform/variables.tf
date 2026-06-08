# ---------------------------------------------------------------------------
# variables.tf
#
# All inputs for the stack. Secrets are marked `sensitive = true` and default
# to "" so the configuration validates without any real values present.
# Provide real values via a *.tfvars file (see terraform.tfvars.example) or
# via TF_VAR_<name> environment variables. NEVER commit real secrets.
# ---------------------------------------------------------------------------

# ----------------------------- Core / naming ------------------------------

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name. Used as a prefix for resource names and tags."
  type        = string
  default     = "agent-pipeline"
}

# ----------------------------- Container images ----------------------------
# Pinned image tags for the third-party services. The first-party services
# (api, worker) are built locally and pushed to the ECR repos created in
# ecr.tf; their full image references are computed in ecs.tf.

variable "temporal_image" {
  description = "Self-hosted Temporal server image (auto-setup variant, creates schema)."
  type        = string
  default     = "temporalio/auto-setup:1.29.1"
}

variable "temporal_ui_image" {
  description = "Temporal Web UI image."
  type        = string
  default     = "temporalio/ui:2.34.0"
}

variable "image_tag" {
  description = "Tag to deploy for the first-party api/worker images pushed to ECR."
  type        = string
  default     = "latest"
}

# ----------------------------- Fargate sizing ------------------------------
# Fargate requires valid CPU/memory *combinations*. 512 CPU (.5 vCPU) supports
# 1024/2048/3072/4096 MiB of memory, so the defaults below are a valid pair.
# See AWS docs for the full CPU/memory matrix before changing these.

variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU, 512 = 0.5 vCPU, 1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB. Must form a valid pair with task_cpu."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired running task count per ECS service."
  type        = number
  default     = 1
}

# ----------------------------- Temporal app config -------------------------

variable "temporal_namespace" {
  description = "Temporal namespace the worker/api use."
  type        = string
  default     = "default"
}

variable "temporal_task_queue" {
  description = "Temporal task queue the worker listens on and the api dispatches to."
  type        = string
  default     = "agent-pipeline"
}

# ----------------------------- RDS / Postgres ------------------------------
# Dev-sized Postgres for self-hosted Temporal's persistence. See rds.tf.

variable "db_name" {
  description = "Initial database name created in the RDS instance (Temporal persistence DB)."
  type        = string
  default     = "temporal"
}

variable "db_username" {
  description = "Master username for the RDS Postgres instance (also POSTGRES_USER for Temporal)."
  type        = string
  default     = "temporal"
}

variable "db_password" {
  description = "Master password for the RDS Postgres instance (also POSTGRES_PWD for Temporal). Set via tfvars or TF_VAR_db_password; never commit it."
  type        = string
  default     = ""
  sensitive   = true
}

# ----------------------------- Application secrets -------------------------
# These populate the single Secrets Manager secret (see secrets.tf). They all
# default to "" so the stack validates with no credentials. The app degrades
# gracefully when an integration's vars are empty (see the repo's .env.example).
# All are sensitive and must never be hardcoded or committed.

variable "google_generative_ai_api_key" {
  description = "Google Gemini API key (LLM analyze/plan/codegen)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_token" {
  description = "GitHub PAT with repo scope (open real PRs)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_owner" {
  description = "GitHub owner/org for the target repository."
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_repo" {
  description = "GitHub repository name the agent operates on."
  type        = string
  default     = ""
  sensitive   = true
}

variable "trello_api_key" {
  description = "Trello API key (pull board cards)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "trello_token" {
  description = "Trello API token."
  type        = string
  default     = ""
  sensitive   = true
}

variable "trello_list_id" {
  description = "Trello list id to source cards from."
  type        = string
  default     = ""
  sensitive   = true
}
