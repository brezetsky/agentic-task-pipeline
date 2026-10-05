# ---------------------------------------------------------------------------
# logs.tf
#
# One CloudWatch Logs group per service (14-day retention). The awslogs driver
# in each container definition (ecs.tf) ships stdout/stderr here.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "temporal" {
  name              = "/ecs/${var.project_name}/temporal"
  retention_in_days = 14
  tags              = { Name = "${var.project_name}-temporal" }
}

resource "aws_cloudwatch_log_group" "temporal_ui" {
  name              = "/ecs/${var.project_name}/temporal-ui"
  retention_in_days = 14
  tags              = { Name = "${var.project_name}-temporal-ui" }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.project_name}/worker"
  retention_in_days = 14
  tags              = { Name = "${var.project_name}-worker" }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project_name}/api"
  retention_in_days = 14
  tags              = { Name = "${var.project_name}-api" }
}
