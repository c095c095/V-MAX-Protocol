# `Auth-Token` header แบบ shared-secret บน REGISTER แทน TLS เต็มรูปแบบ

> **สถานะ**: ออกแบบแล้ว (ADR นี้), ยังไม่ implement ใน `src/*.ts`

ปัจจุบัน VMP ไม่มีการยืนยันตัวตนใดๆ เลย — ใครก็ตามที่เปิด TCP connection มาที่ port
ของ server แล้วส่ง REGISTER ที่ header ครบถ้วน (Node-ID/Node-Type/Plot-ID ที่ผ่าน
validation) ก็จะถูกลงทะเบียนทันที วิชา Networking คาดหวัง security-awareness ใน
โปรโตคอลที่ออกแบบเอง เราจึงเพิ่มชั้นยืนยันตัวตนแบบเบาที่สุดที่ยังมีความหมาย: **shared
secret ผ่าน header `Auth-Token`**

## สเปกที่ต้อง implement

- **ฝั่ง server (`server.ts`)**: เพิ่ม CLI flag ทางเลือก `--secret <token>` (parse ด้วย
  helper แบบเดียวกับ `getArg()` ที่ `client.ts` มีอยู่แล้ว แต่ `server.ts` ยังไม่มี ต้อง
  เพิ่มเข้าไป) ถ้าไม่ระบุ `--secret` เลย = **ไม่มีการเช็ค auth ใดๆ** (backward compatible
  กับ demo flow เดิมทั้งหมด) ถ้าระบุไว้: ใน `handleRegister` ต้องมี header
  `Auth-Token` ตรงกับค่า secret ทุกตัวอักษร ไม่ตรง/ไม่มี header นี้เลย → ตอบกลับ
  **`403 Forbidden`** (status code ใหม่ ดูด้านล่าง) พร้อม log ตามปกติ
- **ฝั่ง client (`client.ts`)**: เพิ่ม CLI flag ทางเลือก `--token <token>` (ผ่าน
  `getArg()` เดิม) ถ้าระบุไว้ แนบเป็น header `Auth-Token` บน REGISTER request
- **ฝั่ง `protocol.ts`**: เพิ่ม `403: 'Forbidden'` เข้าไปใน `STATUS_PHRASES`

## เหตุผล

1. ทุกวันนี้ node ปลอม (rogue node) ใดๆ ก็ REGISTER เข้าระบบได้ถ้ารู้แค่รูปแบบ
   Node-ID/Node-Type/Plot-ID ที่ผ่าน validation — เรื่องนี้เป็นช่องโหว่ที่ควรพูดถึงและ
   แก้ในระดับที่เหมาะสมกับขอบเขตของ assignment
2. Shared-secret token เป็นกลไก authentication ที่เข้าใจง่าย ตรงไปตรงมา demo ได้ชัดใน
   วิดีโอ (REGISTER ด้วย token ผิด → เห็น `403` ทันที) โดยไม่ต้องเพิ่มความซับซ้อนเรื่อง
   cert/key management
3. Backward-compatible เต็มรูปแบบ — ไม่ใส่ `--secret` ระบบทำงานเหมือนเดิมทุกอย่าง ไม่
   กระทบ happy-path/error-case ที่ทดสอบผ่านไปแล้วตาม `handoff-vmp-project.md`

## ทางเลือกที่พิจารณาแต่ไม่เลือก (deferred, ไม่ implement)

**TLS จริง** (เปลี่ยนจาก `net` module เป็น `tls` module เพื่อ encrypt ทั้ง connection)
จะให้ทั้ง confidentiality และ authentication ที่แข็งแรงกว่ามาก และแสดงความเข้าใจ
transport security ได้ลึกกว่า `Auth-Token` header เปล่าๆ มาก — แต่ต้องมีการสร้าง/
จัดการ certificate และ private key เพิ่ม ซึ่งเพิ่มความเสี่ยงเรื่อง environment ตอน demo/
ตรวจงาน (ประเด็นเดียวกับที่ ADR 0005 หยิบยกไว้เรื่องความน่าเชื่อถือของ environment
ตอน grading) เมื่อชั่งเวลาที่เหลือกับ PDF/วิดีโอที่ยังไม่เริ่มเลย (ดู
`handoff-vmp-project.md`) จึงเลือกบันทึกไว้เป็นแนวทางที่พิจารณาแล้วแต่ยังไม่ implement
(ดูสรุปรวมใน ADR 0011) แทนที่จะลงมือทำตอนนี้
