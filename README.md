# Open Market · Valle de Punilla

Marketplace comercial del Valle de Punilla (Córdoba). Cada publicación muestra una foto que abre WhatsApp con el teléfono de ese negocio, y el número también aparece debajo de la imagen.

- **Web pública:** https://playok24.github.io/open-market/
- **Panel de edición:** https://playok24.github.io/open-market/admin/

## Cómo funciona

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | Web pública |
| `admin/index.html` | Panel para editar publicaciones y textos |
| `data/publications.json` | Publicaciones (título, rubro, localidad, teléfono, foto, etc.) |
| `data/config.json` | Textos del sitio, rubros y WhatsApp del organizador |
| `assets/uploads/` | Fotos subidas desde el panel |
| `assets/placeholders/` | Imágenes de ejemplo (reemplazar por fotos reales) |

## Publicar cambios desde el panel

1. Creá un **Personal Access Token (classic)** con permiso `repo` en https://github.com/settings/tokens.
2. Entrá al panel `/admin/`, pegá el token en la barra lateral y tocá **Conectar**.
3. Editá o agregá publicaciones y tocá **Guardar en GitHub**.

El token queda solo en el `localStorage` del navegador; nunca se guarda en el repositorio. Sin token se puede editar en modo borrador y descargar el JSON.

## Reemplazar las fotos de ejemplo

Las 8 publicaciones iniciales usan imágenes SVG de ejemplo. En el panel, abrí cada publicación y elegí una foto real desde tu computadora. La imagen se reduce a 1400 px y se sube a `assets/uploads/`.

## Actualización de GitHub Pages

El sitio se publica desde la rama `main` con GitHub Pages (Settings → Pages → Deploy from branch → main / root). Cada `push` a `main` actualiza la web en unos segundos.
