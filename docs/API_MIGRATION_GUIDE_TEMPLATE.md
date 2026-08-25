# API Migration Guide: {{FROM_VERSION}} → {{TO_VERSION}}

> Template — copy this file to `docs/migration/{{FROM_VERSION}}-to-{{TO_VERSION}}.md`
> and fill in the placeholders when deprecating a version.

## Timeline

| Milestone        | Date (ISO 8601)    | What happens |
| ---------------- | ------------------ | ------------ |
| Deprecation      | {{DEPRECATED_AT}}  | `Deprecation`, `Sunset`, `X-API-Deprecation-Date` and `X-API-Sunset-Date` headers appear on every response |
| Warning window   | 30 days before sunset | Every response carries `Warning: 299 - "This API version will be sunset on {{SUNSET_AT}}"` |
| **Sunset**       | {{SUNSET_AT}}      | All requests receive **HTTP 410 Gone** with body `{ code: "API_VERSION_SUNSET", message, migrationGuide }` |

## Breaking changes

- {{BREAKING_CHANGE_1}}
- {{BREAKING_CHANGE_2}}

## Migration steps

1. {{MIGRATION_STEP_1}}
2. {{MIGRATION_STEP_2}}

### Example: before

```http
GET /api/{{FROM_VERSION}}/{{ENDPOINT}} HTTP/1.1
```

```json
{{OLD_RESPONSE_SHAPE}}
```

### Example: after

```http
GET /api/{{TO_VERSION}}/{{ENDPOINT}} HTTP/1.1
```

```json
{{NEW_RESPONSE_SHAPE}}
```

## Need more time?

Individual users can be granted a temporary exemption from the 410 block
(gradual sunset). Ask the API team, or have an administrator:

```
POST /admin/sunset-exemptions
{
  "userId": "<your-user-id>",
  "apiVersion": "{{FROM_VERSION}}",
  "reason": "Q4 freeze — migrate in January",
  "expiresAt": "{{EXEMPTION_EXPIRES_AT}}"
}
```

Exempt calls continue past `sunsetAt` and carry an `X-Sunset-Exemption: active`
response header so you can verify the exemption is being applied.

## Questions

- Docs: https://docs.mentorminds.com/api/migration/{{FROM_VERSION}}-to-{{TO_VERSION}}
- Support: {{SUPPORT_CHANNEL}}
