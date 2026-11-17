import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AccessToken } from 'livekit-server-sdk';
import chat from './chat';

const env = process.env as Record<string, string>;
const ROOM = 'canal-general';

const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  nickname: { type: String, trim: true, maxlength: 20 },
}));

// En serverless se reutiliza la conexión entre invocaciones
let conn: Promise<typeof mongoose> | null = null;
const db = () => (conn ??= mongoose.connect(env.MONGO_URI).catch((e) => { conn = null; throw e; }));

const app = express();
app.use(cors());
app.use(express.json());
app.use(async (_req, _res, next) => { try { await db(); next(); } catch (e) { next(e); } });

const sign = (u: { id: string; name: string }) =>
  jwt.sign({ id: u.id, name: u.name }, env.JWT_SECRET, { expiresIn: '30d' });

const cleanNick = (s: unknown) => String(s ?? '').trim().slice(0, 20);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nickTaken = async (nick: string, exceptId?: string) =>
  !!(await User.exists({ nickname: new RegExp(`^${esc(nick)}$`, 'i'), ...(exceptId ? { _id: { $ne: exceptId } } : {}) }));

app.get('/', (_req, res) => res.json({ ok: true, app: 'DomiRadio' }));

app.post('/auth/register', async (req, res) => {
  const { name, email, password, nickname } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Datos inválidos (clave mínimo 6 caracteres)' });
  if (await User.findOne({ email: String(email).toLowerCase() }))
    return res.status(409).json({ error: 'Ese correo ya está registrado' });
  const nick = cleanNick(nickname);
  if (nick && (await nickTaken(nick))) return res.status(409).json({ error: 'Ese sobrenombre ya está en uso' });
  const u = await User.create({ name, email, password: await bcrypt.hash(password, 10), ...(nick ? { nickname: nick } : {}) });
  res.json({ token: sign(u), name: nick || u.name });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const u = await User.findOne({ email: String(email).toLowerCase() });
  if (!u || !(await bcrypt.compare(password, u.password)))
    return res.status(401).json({ error: 'Correo o clave incorrectos' });
  res.json({ token: sign(u), name: u.nickname || u.name });
});

const auth = (req: Request, res: Response, next: NextFunction) => {
  try {
    (req as any).user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'No autorizado' }); }
};

// Cambiar el sobrenombre (vacío = volver al nombre real)
app.put('/auth/nickname', auth, async (req, res) => {
  const id = (req as any).user.id;
  const nick = cleanNick(req.body.nickname);
  if (nick && (await nickTaken(nick, id))) return res.status(409).json({ error: 'Ese sobrenombre ya está en uso' });
  const u: any = await User.findByIdAndUpdate(id, nick ? { nickname: nick } : { $unset: { nickname: 1 } }, { new: true });
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ name: u.nickname || u.name });
});

// Token de LiveKit. canUpdateOwnMetadata permite publicar el estado (Disponible/Ocupado)
app.post('/livekit/token', auth, async (req, res) => {
  const user = (req as any).user;
  const me: any = await User.findById(user.id).lean();
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: user.id, name: (me && (me.nickname || me.name)) || user.name });
  at.addGrant({ room: ROOM, roomJoin: true, canPublish: true, canSubscribe: true, canUpdateOwnMetadata: true });
  res.json({ token: await at.toJwt(), url: env.LIVEKIT_URL });
});

app.use('/chat', chat);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

export default app;
