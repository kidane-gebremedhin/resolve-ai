# API and Integrations

## Authentication

The REST API authenticates with a bearer token created in Settings, Developers.
Tokens are scoped to a single workspace and can be revoked at any time.

## Rate limits

The API allows 600 requests per minute per workspace. Exceeding it returns HTTP
429 with a `Retry-After` header. The limit is not raised on request; batch
endpoints exist for bulk work.

## Webhooks

Webhooks are signed with HMAC-SHA256. The signature is sent in the
`X-Northwind-Signature` header and is computed over the raw request body.
Failed deliveries are retried five times with exponential backoff over 24 hours.

## Available integrations

We integrate with Slack, Zapier, HubSpot and Salesforce. A Microsoft Teams
integration is not available.
