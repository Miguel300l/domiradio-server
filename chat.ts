import { Router } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  text: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now, index: true },
}));

const fmt = (m: any) => ({ id: String(m._id), from: m.from, to: m.to, text: m.text, createdAt: new Date(m.createdAt).toISOString() });
const router = Router();

router.use((req, res, next) => {
  try {
    (req as any).user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET as string);
    next();
  } catch { res.status(401).json({ error: 'No autorizado' }); }
});

// Lista de usuarios con quienes se puede chatear
router.get('/users', async (req, res) => {
  const me = (req as any).user.id;
  const users = await mongoose.model('User').find({ _id: { $ne: me } }, 'name').sort({ name: 1 }).lean();
  res.json(users.map((u: any) => ({ id: String(u._id), name: u.name })));
});

// Conversación entre yo y otro usuario (últimos 100, o solo los nuevos con ?after=)
router.get('/messages/:other', async (req, res) => {
  const me = (req as any).user.id;
  const other = req.params.other;
  const q: any = { $or: [{ from: me, to: other }, { from: other, to: me }] };
  if (req.query.after) q.createdAt = { $gt: new Date(String(req.query.after)) };
  const msgs = await Message.find(q).sort({ createdAt: -1 }).limit(100).lean();
  res.json(msgs.reverse().map(fmt));
});

// Enviar un mensaje de texto
router.post('/messages', async (req, res) => {
  const me = (req as any).user.id;
  const to = String(req.body.to || '');
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Mensaje inválido' });
  if (!mongoose.isValidObjectId(to) || !(await mongoose.model('User').exists({ _id: to })))
    return res.status(404).json({ error: 'Usuario no encontrado' });
  const m = await Message.create({ from: me, to, text });
  res.json(fmt(m));
});

export default router;
