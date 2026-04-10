FROM python:3.11

# pymeshlab plugins need OpenGL and Qt libraries even in headless mode
RUN apt-get update && apt-get install -y \
    libopengl0 \
    libglib2.0-0 \
    libgl1 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Run Qt headless (no display required)
ENV QT_QPA_PLATFORM=offscreen
ENV PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY mesh_utils.py remesh_server.py ./

CMD ["python", "remesh_server.py"]
