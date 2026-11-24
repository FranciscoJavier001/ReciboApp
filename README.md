# ReciboApp V1.1

ReciboApp es una PWA offline para registrar ventas, cobrar productos y generar tickets digitales. Eslogan: **Pesa, registra y cobra**.

La versión 1.1 agrega precios P1/P2/P3, botones de cantidades rápidas configurables, control de inventario y registro de movimientos. Las ventas descuentan existencias al confirmarse; cancelar una venta repone únicamente lo que se había descontado.

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

El estado actual se guarda de forma conjunta en `reciboapp_v11_state`, para que cada operación relacionada (por ejemplo, venta, inventario y movimiento) se escriba como una sola actualización. Al iniciar, ReciboApp migra automáticamente las claves anteriores de V1:

- `reciboapp_v1_products`
- `reciboapp_v1_sales`
- `reciboapp_v1_settings`
- `reciboapp_v1_cart`
- `reciboapp_v1_sequence`

Los cálculos monetarios se realizan en centavos enteros. Las cantidades de peso se manejan internamente en gramos enteros y se muestran en la unidad configurada. Los kilogramos admiten tres decimales; las demás unidades usan cantidades enteras.

## Importación y exportación

Ajustes permite exportar un respaldo JSON y reemplazar los datos mediante un archivo previamente validado, incluidos los movimientos de inventario. La aplicación pide confirmación antes de importar o restablecer datos. Los precios P2/P3 que no estén configurados se cobran con el precio P1.

## Limitaciones conocidas

- Los datos permanecen únicamente en el navegador/dispositivo.
- No existe sincronización entre dispositivos.
- Compartir archivos depende de las capacidades de Web Share API.
- La cámara, báscula, impresora y factura fiscal no están integradas.
- Cambiar o borrar los datos del navegador puede eliminar información local.
