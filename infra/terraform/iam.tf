# ---------------------------------------------------------------------------
# iam.tf
#
# Two IAM roles for ECS Fargate:
#
#   * Task EXECUTION role  — used by the ECS agent (not your app) to pull
#     images from ECR, write logs to CloudWatch, and fetch the Secrets Manager
#     secret to inject as env. Gets the AWS-managed execution policy plus a
#     narrow inline policy for GetSecretValue on our one secret.
#
#   * Task role            — the identity your *application code* runs as.
#     Kept minimal (no extra permissions) because the app talks to Temporal,
#     RDS, and external APIs over the network, not to AWS APIs.
# ---------------------------------------------------------------------------

# Trust policy: allow the ECS tasks service to assume these roles.
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --------------------------- Task execution role ---------------------------

resource "aws_iam_role" "task_execution" {
  name               = "${var.project_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = { Name = "${var.project_name}-ecs-execution" }
}

# Managed policy: ECR pull + CloudWatch Logs writes for the ECS agent.
resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Inline policy: allow reading ONLY our application secret so the `secrets`
# blocks in the task definitions can resolve their valueFrom references.
data "aws_iam_policy_document" "secrets_read" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "${var.project_name}-read-app-secret"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.secrets_read.json
}

# ------------------------------- Task role ---------------------------------
# Minimal: no attached permissions. Add scoped policies here only if the app
# itself starts calling AWS APIs (e.g. S3, SQS).

resource "aws_iam_role" "task" {
  name               = "${var.project_name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = { Name = "${var.project_name}-ecs-task" }
}
