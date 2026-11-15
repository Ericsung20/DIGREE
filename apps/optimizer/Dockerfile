# DIGREE optimizer: standalone API image.
#
# Build context: apps/optimizer/ (this directory). Nothing outside it is used,
# and .dockerignore limits the context to pyproject.toml and app/.
#
#   docker build -t digree-optimizer apps/optimizer      # from the repository root
#   docker run --rm -p 8000:8000 digree-optimizer

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install the pinned runtime dependencies and the `app` package from
# pyproject.toml, then remove the sources: the image runs the installed copy.
WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN pip install . && rm -rf /build

# Run unprivileged, from a directory with nothing in it.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin optimizer
WORKDIR /srv
USER optimizer

# Optional search limits; see README.md. Unset means the built-in defaults.
#   DIGREE_MAX_SEARCH_STEPS      default 100000
#   DIGREE_MAX_OPTIONAL_COURSES  default 20

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
