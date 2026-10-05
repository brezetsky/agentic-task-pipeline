# ---------------------------------------------------------------------------
# ecr.tf
#
# One ECR repository each for the first-party images (api, worker). Build and
# push these before applying (see README). Image scanning on push is enabled.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name = "${var.project_name}/api"

  # Scan images for known CVEs as soon as they are pushed.
  image_scanning_configuration {
    scan_on_push = true
  }

  # MUTABLE keeps the example simple (a moving "latest" tag works). For
  # production prefer IMMUTABLE tags + digest-pinned deploys.
  image_tag_mutability = "MUTABLE"

  tags = { Name = "${var.project_name}-api" }
}

resource "aws_ecr_repository" "worker" {
  name = "${var.project_name}/worker"

  image_scanning_configuration {
    scan_on_push = true
  }

  image_tag_mutability = "MUTABLE"

  tags = { Name = "${var.project_name}-worker" }
}
