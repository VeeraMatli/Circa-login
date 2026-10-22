terraform {
  required_version = ">= 1.6"
  required_providers { cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" } }
}
provider "cloudflare" {} # CLOUDFLARE_API_TOKEN comes from the secure runtime.
variable "account_id" { type = string }
variable "environment" {
  type = string
  validation { condition = contains(["staging", "production"], var.environment)
    error_message = "Use staging or production." }
}
resource "cloudflare_d1_database" "database" {
  account_id = var.account_id
  name = "anvaya-${var.environment}"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name = "anvaya-${var.environment}-media"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_queue" "events" {
  account_id = var.account_id
  queue_name = "anvaya-${var.environment}-events"
}
resource "cloudflare_queue" "dead_letter" {
  account_id = var.account_id
  queue_name = "anvaya-${var.environment}-dead-letter"
}
output "database_id" { value = cloudflare_d1_database.database.id }
output "bucket_name" { value = cloudflare_r2_bucket.media.name }
output "events_queue" { value = cloudflare_queue.events.queue_name }
output "dead_letter_queue" { value = cloudflare_queue.dead_letter.queue_name }
