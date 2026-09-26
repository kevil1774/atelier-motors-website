import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
const port=process.env.PORT||5000;
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/atelier-motors').then(()=>app.listen(port,()=>console.log(`Atelier Motors API listening on ${port}`))).catch(e=>{console.error('MongoDB connection failed:',e.message);process.exit(1)});
