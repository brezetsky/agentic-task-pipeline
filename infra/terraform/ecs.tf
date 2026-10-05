# ---------------------------------------------------------------------------
# ecs.tf
#
# The compute core: a Fargate cluster, AWS Cloud Map private DNS for
# service-to-service discovery, and four task definitions + services:
#
#   temporal      Temporal server (gRPC 7233), backed by RDS Postgres.
#   temporal-ui   Temporal Web UI (8080), points at temporal via Cloud Map.
#   worker        Our Temporal worker (no inbound ports).
#   api           Our Express API + SPA (3001), fronted by the ALB.
#
# Inter-service DNS uses Cloud Map: every service registers an A record in the
# private namespace "<project>.local", so e.g. worker/api/temporal-ui reach the
# server at "temporal.<project>.local:7233".
# ---------------------------------------------------------------------------

locals {
  # Cloud Map private DNS namespace name.
  namespace_name = "${var.project_name}.local"

  # Stable in-cluster address for the Temporal server, used by the UI, worker,
  # and api. "temporal" is the Cloud Map service name registered below.
  temporal_dns_address = "temporal.${local.namespace_name}:7233"

  # Full image references for the first-party services pushed to ECR.
  api_image    = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
  worker_image = "${aws_ecr_repository.worker.repository_url}:${var.image_tag}"

  # The JSON keys stored in the app secret (secrets.tf). Reused to build the
  # ECS `secrets` blocks for the worker and api so the two stay in sync.
  app_secret_keys = [
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GITHUB_TOKEN",
    "GITHUB_OWNER",
    "GITHUB_REPO",
    "TRELLO_API_KEY",
    "TRELLO_TOKEN",
    "TRELLO_LIST_ID",
  ]

  # ECS `secrets` entries. valueFrom uses the documented Secrets Manager JSON
  # syntax "<secret-arn>:<json-key>::" so ECS injects just that key's value.
  app_secrets = [
    for k in local.app_secret_keys : {
      name      = k
      valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::"
    }
  ]
}

# ------------------------------ Cloud Map ----------------------------------

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = local.namespace_name
  description = "Private DNS namespace for ${var.project_name} service discovery."
  vpc         = data.aws_vpc.default.id
}

# Helper: every service gets the same DNS + health-check config, differing only
# by name. Defined once and referenced four times.
#
# routing_policy MULTIVALUE returns all healthy task IPs for the name.
# A 10s TTL keeps clients reasonably current as tasks recycle.
resource "aws_service_discovery_service" "temporal" {
  name = "temporal"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  # Cloud Map requires a health-check config; for awsvpc tasks the ECS service
  # updates instance health, so a custom (ECS-managed) check is appropriate.
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_service_discovery_service" "temporal_ui" {
  name = "temporal-ui"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_service_discovery_service" "worker" {
  name = "worker"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_service_discovery_service" "api" {
  name = "api"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

# ------------------------------- Cluster -----------------------------------

resource "aws_ecs_cluster" "this" {
  name = var.project_name

  # Surface container-level CloudWatch metrics.
  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = var.project_name }
}

# =====================================================================
# Task definitions
#
# container_definitions is a JSON STRING (per the AWS provider v5 schema),
# produced with jsonencode([...]) so quoting/escaping is always correct.
# =====================================================================

# ----------------------------- temporal ------------------------------------
resource "aws_ecs_task_definition" "temporal" {
  family                   = "${var.project_name}-temporal"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "temporal"
      image     = var.temporal_image
      essential = true

      portMappings = [
        { containerPort = 7233, protocol = "tcp" }
      ]

      # Temporal auto-setup configuration. POSTGRES_SEEDS is the RDS host.
      # The DB master password is injected from Secrets Manager via `secrets`
      # below (POSTGRES_PWD) so it is not embedded in the task definition.
      environment = [
        { name = "DB", value = "postgres12" },
        { name = "DB_PORT", value = "5432" },
        { name = "POSTGRES_USER", value = var.db_username },
        { name = "POSTGRES_SEEDS", value = aws_db_instance.temporal.address },
        # false => let auto-setup create/verify the schema on boot.
        { name = "SKIP_DB_CREATE", value = "false" },
      ]

      secrets = [
        # RDS master password, injected as Temporal's POSTGRES_PWD. The value
        # lives under the POSTGRES_PWD key of the app secret (secrets.tf,
        # sourced from var.db_password) so it is never embedded in this task
        # definition or the environment list above.
        {
          name      = "POSTGRES_PWD"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:POSTGRES_PWD::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.temporal.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "temporal"
        }
      }
    }
  ])

  tags = { Name = "${var.project_name}-temporal" }
}

# --------------------------- temporal-ui -----------------------------------
resource "aws_ecs_task_definition" "temporal_ui" {
  family                   = "${var.project_name}-temporal-ui"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "temporal-ui"
      image     = var.temporal_ui_image
      essential = true

      portMappings = [
        { containerPort = 8080, protocol = "tcp" }
      ]

      environment = [
        # Reach the server via Cloud Map DNS.
        { name = "TEMPORAL_ADDRESS", value = local.temporal_dns_address },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.temporal_ui.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "temporal-ui"
        }
      }
    }
  ])

  tags = { Name = "${var.project_name}-temporal-ui" }
}

# ------------------------------- worker ------------------------------------
resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project_name}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = local.worker_image
      essential = true

      # No inbound ports: the worker polls Temporal outbound.

      environment = [
        { name = "TEMPORAL_ADDRESS", value = local.temporal_dns_address },
        { name = "TEMPORAL_NAMESPACE", value = var.temporal_namespace },
        { name = "TEMPORAL_TASK_QUEUE", value = var.temporal_task_queue },
      ]

      # LLM/GitHub/Trello secrets injected from Secrets Manager.
      secrets = local.app_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  tags = { Name = "${var.project_name}-worker" }
}

# -------------------------------- api --------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = local.api_image
      essential = true

      portMappings = [
        { containerPort = 3001, protocol = "tcp" }
      ]

      environment = [
        { name = "TEMPORAL_ADDRESS", value = local.temporal_dns_address },
        { name = "TEMPORAL_NAMESPACE", value = var.temporal_namespace },
        { name = "TEMPORAL_TASK_QUEUE", value = var.temporal_task_queue },
        # Bind the Express server to the port the target group health-checks.
        { name = "API_PORT", value = "3001" },
      ]

      # Same app secrets as the worker.
      secrets = local.app_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  tags = { Name = "${var.project_name}-api" }
}

# =====================================================================
# Services
#
# All run launch_type FARGATE in the default subnets with the ECS SG and a
# public IP (so they can pull images without a NAT gateway — see network.tf).
# Each registers with its Cloud Map service for DNS discovery.
# =====================================================================

# ----------------------------- temporal ------------------------------------
resource "aws_ecs_service" "temporal" {
  name            = "temporal"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.temporal.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true # required in public subnets to reach ECR/internet
  }

  service_registries {
    registry_arn = aws_service_discovery_service.temporal.arn
  }

  # Temporal needs its database reachable before it can finish auto-setup.
  depends_on = [aws_db_instance.temporal]
}

# --------------------------- temporal-ui -----------------------------------
resource "aws_ecs_service" "temporal_ui" {
  name            = "temporal-ui"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.temporal_ui.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.temporal_ui.arn
  }

  # The UI is useless until the server is up. NOTE: depends_on only orders
  # resource creation, not in-container readiness — Temporal still needs ~a
  # minute to initialize its schema after the task starts. The UI/clients
  # retry their connection, so transient startup errors are expected.
  depends_on = [aws_ecs_service.temporal]
}

# ------------------------------- worker ------------------------------------
resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.worker.arn
  }

  # Worker connects to Temporal on boot; same readiness caveat as above (it
  # retries until the server is accepting connections).
  depends_on = [aws_ecs_service.temporal]
}

# -------------------------------- api --------------------------------------
resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.api.arn
  }

  # Register api tasks behind the ALB target group on container port 3001.
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  # Ensure the listener (and thus the target group wiring) exists first, and
  # that Temporal is coming up. Same readiness caveat as above.
  depends_on = [
    aws_lb_listener.http,
    aws_ecs_service.temporal,
  ]
}
