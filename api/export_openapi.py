"""Export the OpenAPI spec to api/openapi.json.

Run from the api/ directory:

    uv run python export_openapi.py

This imports the FastAPI app and serializes app.openapi(). It needs neither the
database nor the embedding model (the model is loaded lazily), so it is safe to
run in CI or offline.
"""

import json
import os

from app import app


def main() -> None:
    spec = app.openapi()
    out_path = os.path.join(os.path.dirname(__file__), "openapi.json")
    with open(out_path, "w") as f:
        json.dump(spec, f, indent=2)
        f.write("\n")
    print(
        f"Wrote {out_path} — OpenAPI {spec.get('openapi')}, "
        f"{len(spec.get('paths', {}))} paths."
    )


if __name__ == "__main__":
    main()
