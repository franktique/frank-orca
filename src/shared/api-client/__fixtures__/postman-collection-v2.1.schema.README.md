# Postman Collection v2.1 JSON schema

- Source: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
- Retrieved: 2026-10-02
- License: Apache-2.0 (published by Postman at https://github.com/postmanlabs/schemas)
- Draft: JSON Schema draft-04. Ajv 8 has no draft-04 meta-schema, so `postman-export.test.ts` drops
  the top-level `$schema` and `id` keys before compiling.
- Used only by `src/shared/api-client/postman-export.test.ts` (SC-007).
