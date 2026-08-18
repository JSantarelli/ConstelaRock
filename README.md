# Mapa Musical 3D — prueba UMAP

Abrir mediante un servidor local (no `file://`), por ejemplo:

    python3 -m http.server 8000

Luego visitar `http://localhost:8000`.

## Modelo

1. Cada álbum se convierte en un vector común de géneros + descriptores.
2. Géneros principales: peso inicial 1.0, con una leve reducción por posición.
3. Géneros secundarios: peso inicial 0.55, con reducción progresiva por posición.
4. Descriptores: peso configurable (0–0.5), por defecto 0.12.
5. UMAP reduce el vector de alta dimensión a 3 dimensiones latentes.
6. Las coordenadas se normalizan visualmente a aproximadamente [-45,45] por eje.
7. El color no proviene de UMAP: representa la firma de géneros principales compartidos.

Los ejes X/Y/Z son deliberadamente no semánticos.
