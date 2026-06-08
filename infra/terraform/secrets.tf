# ---------------------------------------------------------------------------
# secrets.tf
#
# A single Secrets Manager secret holding a JSON object of the app's sensitive
# values. The ECS task definitions (ecs.tf) inject individual keys into the
# containers via the `secrets` block, referencing them as:
#     <secret-arn>:<KEY>::
# which tells ECS to pull just that JSON key from this secret.
#
# Values come from the sensitive *_api_key / token / id variables (all default
# to "" so the stack validates and the app degrades gracefully when empty).
# Nothing sensitive is hardcoded here.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.project_name}/app"
  description = "Application secrets (LLM/GitHub/Trello) for ${var.project_name}."

  # Demo convenience: allow immediate name reuse after deletion. In production
  # consider the default 30-day recovery window instead.
  recovery_window_in_days = 0

  tags = { Name = "${var.project_name}-app-secrets" }
}

# The secret payload. Keys here MUST match the names referenced in the ECS
# task definitions' `secrets` blocks (see locals.app_secret_keys in ecs.tf).
resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    GOOGLE_GENERATIVE_AI_API_KEY = var.google_generative_ai_api_key
    GITHUB_TOKEN                 = var.github_token
    GITHUB_OWNER                 = var.github_owner
    GITHUB_REPO                  = var.github_repo
    TRELLO_API_KEY               = var.trello_api_key
    TRELLO_TOKEN                 = var.trello_token
    TRELLO_LIST_ID               = var.trello_list_id

    # RDS master password, surfaced to the Temporal container as POSTGRES_PWD
    # via the `secrets` block in its task definition (ecs.tf). Stored here so
    # the DB password is never embedded in a task definition or env list.
    POSTGRES_PWD = var.db_password
  })
}
