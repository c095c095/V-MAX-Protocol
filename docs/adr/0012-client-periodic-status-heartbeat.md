# Client ส่ง STATUS เองทุก 3 ครั้งของ PUSH แทนที่จะไม่เคยส่งเลย

> **สถานะ**: Implement แล้วใน `src/client/index.ts` — ทดสอบผ่านแล้วทั้ง server-side
> (`tests/integration.test.ts`: STATUS ตอน registered → 200, ตอนไม่ registered → 401) และ
> client-side จริง (รัน client จริงด้วย `--interval 1` ยืนยันว่า `STATUS` ถูกส่งหลัง PUSH
> ที่ 3 และ 6 ตามที่ออกแบบไว้)

`STATUS` เป็น method ที่มีอยู่ใน glossary ตั้งแต่ต้น (`CONTEXT.md`) และ server ฝั่งรับก็รองรับ
ครบสมบูรณ์ (`handleStatus` ใน `src/server/handlers.ts` ตอบ `200`/`401` ถูกต้อง มี automated
test ยืนยัน) **แต่ `client.ts` ไม่เคยมีโค้ดส่ง STATUS request เลยสักบรรทัดเดียว** — ไม่ว่าจะรัน
ผ่าน CLI ตรงๆ หรือผ่าน dashboard demo tool ก็ตาม พบจุดนี้ระหว่างทำ `/scrutinize` เช็ค coverage
ของ dashboard เทียบกับ protocol เต็มรูปแบบ

## สเปกที่ implement แล้ว

- Client เก็บตัวนับ `pushCount` เพิ่มทีละ 1 ทุกครั้งที่ `pushReading()` ทำงาน รีเซ็ตกลับเป็น 0
  ทุกครั้งที่ `startPushing()` เริ่มใหม่ (คือทุกครั้งที่ REGISTER สำเร็จ ทั้งครั้งแรกและหลัง
  reconnect ตาม ADR 0007)
- ทุกๆ 3 ครั้งของ PUSH (`pushCount % 3 === 0`) client จะส่ง `STATUS` เพิ่มอีกหนึ่งข้อความ
  (header แค่ `Node-ID`, body ว่าง — ตรงตาม spec เดิมใน `CONTEXT.md`) บน connection เดียวกัน
- ไม่มี CLI flag ใหม่ ไม่มี timer ใหม่ — ใช้ cadence ของ push loop ที่มีอยู่แล้วเลย (`pushTimer`
  ใน `client/sensors.ts`'s `ClientState`)
- ฝั่ง response: `handleResponse` ใน `client/index.ts` เพิ่ม branch เช็ค `statusCode === 401` —
  เคสนี้เกิดขึ้นได้จากการตอบ STATUS เท่านั้น (REGISTER/PUSH ที่ fail มี branch ของตัวเองอยู่แล้ว
  และ handler นี้ทำงานหลัง REGISTER สำเร็จเท่านั้น) log ข้อความเตือนชัดเจนว่า server ไม่รู้จัก
  node นี้แล้ว แต่**ไม่ได้ทำอะไรมากกว่านั้น** — ไม่ auto re-register ไม่ mark intentional
  disconnect เพราะ auto-reconnect (ADR 0007) จัดการเคส "connection หลุดจริง" ไปแล้วอีกชั้นหนึ่ง

## เหตุผล

1. **ปิดช่องว่างของ implementation ที่มีอยู่จริง** — protocol design และฝั่ง server สมบูรณ์
   อยู่แล้ว มีแค่ client reference implementation ที่ไม่เคยใช้ method นี้เลย ถ้ามีคนถามว่า
   "STATUS อยู่ไหนในโค้ด" คำตอบเดิมคือ "ไม่มีเลย" ตอนนี้มีจุดที่ใช้จริงแล้ว
2. **ผูกกับ cadence ที่มีอยู่แล้วแทนที่จะเพิ่ม timer/flag ใหม่** — ไม่เพิ่ม complexity เรื่อง
   จังหวะเวลาที่ต้องคิดใหม่ ไม่ต้องมี CLI flag เพิ่มให้จำ ตรงกับ philosophy ของโปรเจกต์ที่เลี่ยง
   speculative abstraction (`karpathy-guidelines`)
3. **Detection และ logging เท่านั้น ไม่ทำ auto re-register** — เหตุผลเดียวกับ ADR 0006 (Seq
   gap detection): ไม่อยากให้ mechanism นี้ทับซ้อน/แข่งกับ auto-reconnect ที่มีอยู่แล้ว ถ้า
   ทำ auto re-register ด้วยจะเป็นการสร้าง reliability layer ที่สองที่ต้องคิดเรื่อง
   race condition กับตัวแรกเพิ่ม
4. **จับ 401 ได้แม่นยำโดยไม่ต้องมี request-ID correlation** — เพราะ handler นี้ทำงานเฉพาะหลัง
   REGISTER สำเร็จแล้ว (เข้าสู่ push loop แล้ว) ข้อความ PUSH ของ client เองก็ไม่มีทางได้ 401
   กลับมา (client เริ่ม push หลัง 201 เสมอ) ดังนั้น `401` ที่มาถึง handler นี้จึงเป็นคำตอบของ
   STATUS check เท่านั้น ไม่มีทางกำกวมกับข้อความอื่น

## ทางเลือกที่พิจารณาแต่ไม่เลือก

- **Auto re-register ทันทีที่เห็น STATUS→401** — จะทำให้ node กลับมาใช้งานได้เร็วกว่า แต่เพิ่ม
  ความซับซ้อนให้ต้องคิดว่า mechanism นี้กับ auto-reconnect (ADR 0007) จะแย่งกันทำงานยังไง ใน
  เมื่อสถานการณ์ "TCP ยังต่ออยู่แต่ server ลืม node" แทบไม่เกิดขึ้นจริงในสถาปัตยกรรมปัจจุบัน
  (REGISTER ผูก 1:1 กับ socket เสมอ — ถ้า server ตายจริง TCP connection ก็หลุดไปด้วย ซึ่ง ADR
  0007 จัดการอยู่แล้ว) เลยเลือกแค่ log ไว้พอ
- **Interval แยกต่างหากผ่าน CLI flag ใหม่ (เช่น `--status-interval`)** — ยืดหยุ่นกว่า แต่เพิ่ม
  parameter ให้ผู้ใช้ต้องรู้จักอีกตัวโดยไม่มีประโยชน์ชัดเจนเหนือกว่าการผูกกับ push cadence ที่
  มีอยู่แล้ว
