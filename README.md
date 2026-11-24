# ReciboApp V1

ReciboApp es una PWA offline para registrar ventas, cobrar productos y generar tickets digitales. Eslogan: **Pesa, registra y cobra**.

## Arquitectura

- React + Vite + JavaScript
- Persistencia local con `localStorage`
- Componentes y utilidades separadas
- Generación de PNG mediante canvas
- Service worker para caché offline
- Sin backend ni servicios externos

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Pruebas y compilación

```bash
npm test
npm run lint
npm run build
npm run preview
```

## Despliegue en Vercel

El proyecto puede desplegarse con una configuración estándar de Vite:

```bash
npm run build
vercel deploy --prebuilt
```

No se incluye un despliegue automático. Un despliegue a producción debe autorizarse por el propietario.

## Instalación como PWA en iPhone

1. Abrir la URL publicada en Safari.
2. Seleccionar Compartir.
3. Elegir **Agregar a inicio**.
4. Confirmar el nombre ReciboApp.

## Almacenamiento

Se utilizan las siguientes claves independientes y versionadas:

- `reciboapp_v1_products`
- `reciboapp_v1_sales`
- `reciboapp_v1_settings`
- `reciboapp_v1_cart`
- `reciboapp_v1_sequence`

Los cálculos monetarios se realizan en centavos enteros. Los kilogramos admiten tres decimales y las demás unidades usan cantidades enteras.

## Importación y exportación

Ajustes permite exportar un respaldo JSON y reemplazar los datos mediante un archivo previamente validado. La aplicación pide confirmación antes de importar o restablecer datos.

## Limitaciones conocidas

- Los datos permanecen únicamente en el navegador/dispositivo.
- No existe sincronización entre dispositivos.
- Compartir archivos depende de las capacidades de Web Share API.
- La cámara, báscula, impresora y factura fiscal no están integradas.
- Cambiar o borrar los datos del navegador puede eliminar información local.
