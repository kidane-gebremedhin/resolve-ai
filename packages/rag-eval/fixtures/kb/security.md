# Security and Data Handling

## Encryption

Data is encrypted in transit with TLS 1.3 and at rest with AES-256. Encryption
keys are rotated every 90 days.

## Data residency

Workspaces are hosted in one of two regions, chosen at signup: us-east or
eu-west. Data does not leave the region it was created in. The region cannot be
changed after signup without a migration performed by our team.

## Retention

Deleted workspaces are purged 30 days after deletion. Backups are retained for
35 days and then destroyed.

## Compliance

Northwind Tools is SOC 2 Type II certified. We are not HIPAA compliant and do
not sign Business Associate Agreements.

## Access control

Every workspace supports role-based access with four roles: owner, admin, member
and viewer. Two-factor authentication can be enforced workspace-wide by an
owner.
