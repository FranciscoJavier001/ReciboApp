# ReciboApp V1.2.2

ReciboApp es una PWA para administrar productos e inventario, registrar ventas y generar tickets digitales. **Pesa, registra y cobra.**

La aplicación utiliza React, Vite, Firebase Authentication y Cloud Firestore con el SDK modular. No utiliza Cloud Functions, un servidor propio ni servicios de pago. La interfaz estática puede alojarse en Vercel. El plan Spark no requiere activar Blaze ni vincular una tarjeta para esta arquitectura.

## Requisitos

- Node.js 24.12 o posterior y npm
- Java instalado para ejecutar el emulador local de Firestore
- Un proyecto Firebase con Authentication y Cloud Firestore habilitados

## Configuración de Firebase

1. En Firebase Authentication, habilita **Correo electrónico/contraseña** y la verificación de correo.
2. En Firebase Console, crea o selecciona la aplicación web del proyecto `reciboapp-a74ae`.
3. Copia `.env.example` a `.env.local` y completa la configuración web que proporciona Firebase:

   ```dotenv
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_PROJECT_ID=reciboapp-a74ae
   VITE_FIREBASE_APP_ID=
   ```

   No se incluyen credenciales del proyecto. No agregues claves de cuentas de servicio ni otros secretos administrativos al cliente.
4. Publica únicamente las reglas de Firestore:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project reciboapp-a74ae
   ```

   Este comando no despliega Functions. Comprueba el proyecto de destino antes de ejecutarlo.

Si Firebase no está configurado, la aplicación mostrará instrucciones para configurarlo y no habilitará el acceso comercial.

## Desarrollo, pruebas y compilación

```bash
npm install
npm run dev
npm test
npm run test:rules
npm run lint
npm run build
npm run preview
```

`npm run test:rules` inicia el emulador de Firestore con `firestore.rules` y ejecuta las pruebas de reglas, ventas, cancelaciones, concurrencia, idempotencia, atomicidad e aislamiento. `npm test` incluye pruebas unitarias de inventario, utilidades y sincronización de la cola offline. Las pruebas del emulador utilizan un proyecto demo y no se conectan a Firebase real.

## Datos, seguridad y sincronización

- Authentication conserva el registro, la verificación de correo, el inicio/cierre de sesión y la recuperación de contraseña.
- Las reglas exigen autenticación y correo verificado, y limitan el acceso a `users/{uid}` del usuario autenticado. Validan la forma y los tipos de los documentos comerciales, rechazan existencias negativas y restringen las transiciones de ventas finalizadas. Las rutas no autorizadas se deniegan.
- La confirmación de una venta usa una sola transacción Firestore para leer existencias y escribir la venta, los descuentos, los movimientos, el contador de folios y el carrito. La cancelación también es transaccional: repone existencias, registra movimientos y cambia el estado de la venta. No se divide una venta en varias transacciones.
- Se eliminaron las comprobaciones cruzadas que imponían el límite anterior de cuatro productos. Las pruebas del emulador confirman ventas y cancelaciones atómicas con **1, 4, 10, 30 y 50 productos distintos**. Los identificadores de operación hacen idempotentes los reintentos de ventas; cancelar una venta ya cancelada no vuelve a reponer existencias.
- Para una venta con 50 productos que controlan inventario, el flujo realiza aproximadamente 53 lecturas y 103 escrituras; cancelarla requiere aproximadamente 51 lecturas y 101 escrituras. Son conteos del flujo normal, sin contar lecturas adicionales por reintentos internos de una transacción. Firestore limita cada transacción a 500 escrituras; el tamaño de documentos, las lecturas y las evaluaciones de reglas también imponen límites. Aunque las estructuras admiten hasta 200 renglones, solo se ha validado capacidad comercial hasta 50 productos distintos y no se garantiza que cualquier venta de hasta 200 productos pueda confirmarse.
- Las reglas no demuestran que los cambios de existencias y los movimientos estén correctamente relacionados, ni recalculan de forma autoritativa el total, los precios o las cantidades de una venta. Estas invariantes dependen de la lógica transaccional del cliente durante el uso normal. El modelo acepta que el propietario pueda manipular deliberadamente sus propios datos mediante un cliente personalizado; no ofrece garantías de backend confiable ni es adecuado como registro fiscal o contable inmutable. El aislamiento entre UID sí se aplica en las reglas.
- La caché de Firestore y la cola en IndexedDB toleran conectividad intermitente. Las ventas en cola se muestran como pendientes y solo se eliminan de la cola después de que Firestore confirme la transacción. Si falla la conexión, permanecen pendientes para reintento; una respuesta de error no se presenta como confirmación.
- Las cantidades monetarias se manejan en centavos enteros y las existencias base en gramos o unidades enteras. Kilogramos admiten tres decimales en la interfaz.
- El historial escucha las 500 ventas recientes y permite cargar páginas anteriores. Los productos y movimientos se limitan a 1.000 y 500 documentos en su escucha inicial.
- La migración de datos locales requiere confirmación y conserva el respaldo local. No reemplaza una cuenta que ya tenga datos.
- El restablecimiento elimina los datos de Firestore de la cuenta y la cola local de ventas pendientes.
- Firestore Security Rules protege el aislamiento entre UIDs, pero no sustituye un servidor confiable contra un usuario que controla su propio navegador y sus credenciales.

Firestore Spark tiene cuotas y límites diarios. La aplicación no garantiza disponibilidad al agotarlas; revisa los límites vigentes de Firebase antes de usarla con cargas de producción.

## PWA y alojamiento

Para instalarla en iPhone, abre la aplicación en Safari, selecciona **Compartir** y luego **Agregar a inicio**. El service worker usa una clave de caché por versión para publicar actualizaciones.

La salida de Vite puede alojarse en Vercel como sitio estático. Configura las variables `VITE_FIREBASE_*` en el entorno de compilación y publica las reglas de Firestore por separado. No se realiza despliegue automático desde este repositorio.

## Funcionalidades y límites

Se conservan productos, precios P1/P2/P3, inventario y movimientos, botones de cantidades rápidas, ventas, tickets, historial, ajustes, temas, diseño responsive, áreas seguras de iOS, PWA, respaldos y migración desde `localStorage`.

La cola offline solo admite ventas. Guardar productos, ajustes, movimientos, cancelar ventas, migrar datos y restablecer la cuenta requiere conexión a Firestore. Compartir tickets depende de Web Share API. No se integran cámara, báscula, impresora ni facturación fiscal.
