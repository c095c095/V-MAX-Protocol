# Validate `VMP/1.0` version token ที่ส่งมาทุกข้อความ แทนที่จะปล่อยผ่านเฉยๆ

> **สถานะ**: Implement แล้วใน `src/server/index.ts` (dispatch loop ก่อนเข้า
> `switch`) — type-check ผ่าน แต่ยังไม่เคยทดสอบ end-to-end กับ client จริงที่ส่ง
> version ผิด เพราะ client อ้างอิง `VMP_VERSION` เดียวกันเสมอ

ทุกข้อความของ VMP มี version token (`VMP/1.0`) อยู่ใน start line อยู่แล้วตั้งแต่
ADR 0002 (รูปแบบ HTTP-inspired) — `MessageParser` (`protocol.ts`) ก็ parse เก็บค่านี้
ไว้ใน field `version` ของทุก `ParsedMessage` อยู่แล้วด้วย **แต่ปัจจุบันไม่มีจุดไหนใน
`server.ts` ที่ตรวจสอบค่านี้เลย** — client จะส่ง version อะไรมาก็ถูกประมวลผลเหมือนกัน
หมด ทำให้ version token ที่มีอยู่ในทุกข้อความไม่มีความหมายในทางปฏิบัติ (decorative)

เราจึงเพิ่มการ **validate version** ที่ฝั่ง server

## สเปกที่ต้อง implement

- ในจุด dispatch หลักของ `server.ts` (`socket.on('data', ...)` ก่อนเข้า `switch` ตาม
  `msg.method`) เพิ่มการเช็ค: ถ้า `msg.version !== VMP_VERSION` (ค่าคงที่ที่ export จาก
  `protocol.ts` อยู่แล้ว) → ตอบกลับ **`400 BadRequest`** (ใช้ status code เดิมที่มีอยู่
  แล้ว ไม่ต้องเพิ่ม code ใหม่) พร้อมข้อความ เช่น
  `Unsupported protocol version: <version ที่ส่งมา>` แล้ว log ตามปกติ ไม่ส่งต่อให้
  handler ของ method นั้นๆ ทำงาน
- เช็คนี้ครอบคลุมทุก request method (REGISTER/PUSH/STATUS/UNREGISTER) ไม่ใช่แค่
  REGISTER เพราะ mismatch เกิดขึ้นได้ทุกข้อความในทางทฤษฎี

## เหตุผล

1. Version token ที่ไม่เคยถูกตรวจสอบเลยก็เท่ากับไม่มี — การ validate คือสิ่งที่ทำให้
   "HTTP-inspired versioning" ที่ ADR 0002 ยืมมา กลายเป็น compatibility gate ที่ใช้งาน
   ได้จริง ไม่ใช่แค่ syntax ที่ก็อปมาเฉยๆ
2. เป็นพื้นฐานสำหรับวิวัฒนาการโปรโตคอลในอนาคต — ถ้าวันหน้ามี `VMP/2.0` ที่เปลี่ยน wire
   format การมี validation ตั้งแต่ต้นทำให้ server รุ่นเก่าปฏิเสธ client รุ่นใหม่ที่เข้ากัน
   ไม่ได้อย่างชัดเจน (`400 BadRequest`) แทนที่จะพยายาม parse แล้วพังแบบไม่ทราบสาเหตุ
3. Implement ง่ายมาก — แค่เช็ค string equality หนึ่งจุดในโค้ดที่มีอยู่แล้ว ไม่ต้องแก้
   wire format หรือ `MessageParser` เลย

## ทางเลือกที่พิจารณาแต่ไม่เลือก

**ปล่อยผ่านแบบเดิม (ไม่ validate)** — ง่ายที่สุดเพราะไม่ต้องแก้อะไรเลย แต่หมายความว่า
field `version` ที่ปรากฏอยู่ในทุกข้อความ (และถูก log ออกมาทุกครั้งผ่าน `formatForLog`)
ไม่มีผลต่อพฤติกรรมของระบบเลยแม้แต่น้อย ซึ่งขัดกับเจตนาเดิมของ ADR 0002 ที่อ้างอิงรูปแบบ
HTTP มาโดยเฉพาะ
