// Solo para desarrollo local: npm run dev
import app from './app';
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`DomiRadio server listo en el puerto ${port}`));
