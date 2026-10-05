# ---------------------------------------------------------------------------
# alb.tf
#
# Internet-facing Application Load Balancer that fronts the `api` service
# (Express API + the React SPA). Public users hit the ALB on :80, which
# forwards to the api tasks on :3001.
#
# PRODUCTION CAVEAT: HTTP only here. For production add an HTTPS:443 listener
# with an ACM certificate and redirect HTTP -> HTTPS.
# ---------------------------------------------------------------------------

resource "aws_lb" "app" {
  name               = "${var.project_name}-alb"
  load_balancer_type = "application"
  internal           = false # internet-facing
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids

  tags = { Name = "${var.project_name}-alb" }
}

# Target group for the api tasks. target_type "ip" is required for Fargate
# (awsvpc networking — each task gets its own ENI/IP, not an instance).
resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-api"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  # Health check hits the Express health route confirmed in packages/api.
  health_check {
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.project_name}-api" }
}

# HTTP:80 listener -> api target group.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
