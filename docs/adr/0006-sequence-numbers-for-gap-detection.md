# เพิ่ม `Seq` header ใน PUSH/COMMAND เพื่อตรวจจับข้อความหาย/ซ้ำหลัง reconnect

> **สถานะ**: Implement แล้วใน `src/server/handlers.ts` (`handlePush`) และ
> `src/client/connection.ts`/`src/client/index.ts` — ทดสอบผ่านแล้ว (`Seq` reset
> เป็น `1` ทุกครั้งที่ reconnect, ไล่เลขต่อเนื่องปกติเมื่อไม่มีข้อความหาย)

TCP รับประกันว่าข้อความจะถึงครบและเรียงลำดับถูกต้อง **แต่รับประกันแค่ภายใน connection
เดียว** เท่านั้น เมื่อ node หลุดการเชื่อมต่อแล้ว reconnect ใหม่ (ดู ADR 0007) connection
ใหม่นี้ไม่มี "ความจำ" ใดๆ เกี่ยวกับ connection เดิมเลย — ถ้ามี PUSH บางอันหายไปในช่วงที่
หลุด (เช่น node ส่งไม่ทันก่อนสาย disconnect) ฝั่ง server จะไม่รู้เลยว่ามีข้อมูลหายไปกี่ค่า
เพราะ TCP ของ connection ใหม่เริ่มนับ sequence ของตัวเองใหม่หมด

เราจึงเพิ่ม header **`Seq`** (จำนวนเต็ม, เริ่มที่ `1`, reset เป็น `1` ทุกครั้งที่ REGISTER
สำเร็จ/เริ่ม connection ใหม่) เข้าไปในทุกข้อความ **PUSH** (node → server) และ **COMMAND**
(server → node)

## สเปกที่ต้อง implement

- **ฝั่ง client (`client.ts`)**: มีตัวแปร `seq` เริ่มที่ `0`, reset เป็น `0` ทุกครั้งที่เริ่ม
  connection ใหม่ (ผูกกับ ADR 0007 — ทุกครั้งที่ `connect()` ถูกเรียกใหม่) เพิ่ม `seq += 1`
  ก่อนส่ง PUSH ทุกครั้ง แล้วแนบเป็น header `Seq: <n>`
- **ฝั่ง server (`server.ts`)**: เพิ่ม field `lastSeq: number` เข้าไปใน `RegisteredNode`
  (state เดิมที่เก็บใน `Map<NodeID, RegisteredNode>` อยู่แล้ว) ตั้งต้นเป็น `0` ตอน REGISTER
  สำเร็จ ในทุกครั้งที่ `handlePush` ทำงาน: อ่าน `Seq` header เป็นตัวเลข เทียบกับ
  `lastSeq + 1`
  - ถ้า `Seq > lastSeq + 1` → log ข้อความเตือนว่า "gap: คาดหวัง Seq=X แต่ได้ Seq=Y"
    (ข้อมูลระหว่างนั้นน่าจะหายไปช่วง disconnect)
  - ถ้า `Seq <= lastSeq` → log ข้อความเตือนว่าเป็นข้อความซ้ำ (duplicate/replayed)
  - ไม่ว่ากรณีไหน server ยัง**ประมวลผลและตอบ `200 OK` ตามปกติ** — ฟีเจอร์นี้คือ
    "ตรวจจับแล้ว log" ไม่ใช่ full retransmission/reliable-delivery layer
  - อัปเดต `lastSeq = Math.max(lastSeq, Seq)` เสมอ

## เหตุผล

1. แสดงความเข้าใจที่ถูกต้องว่า TCP รับประกัน reliability **ต่อ connection** ไม่ใช่ต่อ
   "session" ของ node — เป็นจุดที่มักเข้าใจผิดกันว่า TCP = ข้อมูลไม่มีทางหาย ทั้งที่จริง
   แล้วแค่ "ไม่หายภายใน connection เดียวกัน"
2. ต่อยอดโดยตรงจาก ADR 0007 (auto-reconnect) — reconnect ทำให้ "การหลุดแล้วต่อใหม่"
   เป็นเรื่องปกติที่เกิดได้บ่อยขึ้น ยิ่งต้องมีกลไกสังเกตว่ามีอะไรหายไปบ้างระหว่างนั้น
3. Implement ง่าย ไม่ต้องแก้ `MessageParser`/wire format เลย เพราะ header เป็น
   `Record<string,string>` อยู่แล้วใน `protocol.ts` — เพิ่มแค่ key ใหม่ตรงจุดที่ encode/
   decode header ปกติ

## ทางเลือกที่พิจารณาแต่ไม่เลือก

Full at-least-once delivery (server ขอให้ client resend ข้อความที่หายไปจริงๆ ตาม gap ที่
เจอ) จะแสดงความเข้าใจเรื่อง reliable transport ได้ลึกกว่านี้อีก แต่ต้องมี buffer เก็บ
ข้อความเก่าฝั่ง client ไว้ resend, มี ack/nack แยกจาก response ปกติ และเพิ่ม state
management ฝั่ง server อีกชั้น — ซับซ้อนเกินขอบเขตเวลาของโปรเจกต์นี้ (ดู ADR 0011)
เลือก "ตรวจจับแล้ว log" แทน เพราะตรงกับสิ่งที่โจทย์บังคับอยู่แล้วคือการ print
message/status ทุกข้อความ ไม่ใช่การสร้าง reliability layer ใหม่ทั้งหมด
