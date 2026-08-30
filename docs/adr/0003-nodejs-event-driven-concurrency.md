# Server ใช้ event-driven concurrency ของ Node.js เอง แทน manual threading

Server ของ VMP ต้องดูแลหลาย node ที่ REGISTER แล้วค้าง connection ไว้พร้อมกัน (เพื่อให้ server ส่ง COMMAND กลับได้ทุกเมื่อ) โดยไม่บล็อกกัน

เดิม ADR นี้เขียนไว้ในบริบท Python ว่าจะใช้ "thread-per-connection" แต่หลังจากเปลี่ยนมาใช้ Node.js + TypeScript (ADR 0005) แนวคิดนี้ไม่ตรงกับโมเดลของ Node อีกต่อไป — Node ใช้ single-threaded event loop โดยธรรมชาติอยู่แล้ว `net.Server` จัดการหลาย connection พร้อมกันผ่าน event/callback โดยอัตโนมัติ ไม่ต้องสร้าง thread เอง (การทำ thread จริงต้องใช้ `worker_threads` ซึ่งไม่ใช่ pattern ปกติของ Node และไม่จำเป็นสำหรับงานที่เป็น I/O-bound แบบนี้)

การตัดสินใจ: ใช้ **event-driven concurrency ของ Node.js เอง** — แต่ละ connection ที่เข้ามาได้ `socket` object ของตัวเองจาก `server.on('connection', socket => ...)`, ผูก state ของ node ที่ REGISTER แล้ว (node info + socket reference) เข้ากับ `Map<NodeID, ConnectionState>` ที่ server เก็บไว้ เพื่อให้ server หา socket ของ node ใดก็ได้มาส่ง COMMAND ทีหลัง

เหตุผล:
1. เป็น pattern ปกติ/idiomatic ของ Node.js ไม่ต้องฝืนใช้แนวคิดจากภาษาอื่น
2. Node จัดการ concurrent I/O ให้อัตโนมัติโดยไม่บล็อกกัน ตรงกับเป้าหมายเดิมของ ADR นี้ทุกอย่าง
3. โค้ดน้อยกว่า ไม่ต้องจัดการ thread lifecycle เอง

(แทนที่เหตุผลเดิมเรื่อง Python `threading` module ที่ไม่เกี่ยวข้องแล้ว)
