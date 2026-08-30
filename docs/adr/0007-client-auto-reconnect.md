# Client auto-reconnect พร้อม exponential backoff เมื่อหลุดการเชื่อมต่อโดยไม่ตั้งใจ

> **สถานะ**: Implement แล้วใน `src/client/connection.ts` — ทดสอบผ่านแล้วโดยการฆ่า
> server process จริงระหว่าง client กำลังทำงาน ยืนยัน backoff เพิ่มเป็น 1s→2s→4s→8s
> และ reconnect สำเร็จเมื่อ server กลับมา (พบและแก้บั๊กระหว่างทดสอบ: push-interval
> timer เดิมไม่ถูก clear ตอนหลุด connection ทำให้ reconnect แล้วมี timer ซ้อนกันสอง
> อัน — แก้โดยเพิ่ม callback `onDisconnect` ใน `connection.ts`)

ปัจจุบัน `client.ts` เชื่อมต่อ TCP แบบครั้งเดียว (`net.connect(...)` ตอน module โหลด) —
ถ้า connection หลุดไม่ว่าจะจากสาเหตุอะไร (`close` หรือ `error` event) โปรเซสจะ
`process.exit()` ทันที ผู้ใช้ต้อง relaunch client เองด้วยมือ ซึ่งขัดกับ premise ของ
โปรเจกต์นี้ที่จำลอง sensor node ที่ควรทำงานอัตโนมัติในสนามจริง (เช่น สัญญาณ Wi-Fi หลุด
ชั่วคราวไม่ควรทำให้ node ต้องรอคนมา relaunch)

เราจึงเพิ่ม logic **auto-reconnect พร้อม exponential backoff** ฝั่ง client เมื่อหลุดการ
เชื่อมต่อ**โดยไม่ตั้งใจ** เท่านั้น (แยกจากกรณีตั้งใจ เช่น ได้รับ `SHUTDOWN` command หรือ
กด Ctrl+C/`SIGINT` ซึ่งทั้งสองกรณีนี้ส่ง UNREGISTER ก่อนแล้วค่อยปิดอยู่แล้ว)

## สเปกที่ต้อง implement

- Refactor `net.connect(...)` แบบ one-shot ปัจจุบันให้เป็นฟังก์ชัน `connect()` ที่เรียกซ้ำ
  ได้ — สร้าง socket + `MessageParser` ใหม่ทุกครั้ง ผูก event handler (`data`/`close`/
  `error`) ชุดเดิม แล้วส่ง REGISTER ทันทีที่ connect สำเร็จ (เหมือน flow เดิม)
- เพิ่มตัวแปร `intentionalDisconnect = false` — set เป็น `true` ก่อนส่ง UNREGISTER ทั้งใน
  `SHUTDOWN` command handler และใน `SIGINT` handler
- ใน `close` handler: ถ้า `intentionalDisconnect === false` → ไม่ `process.exit()` แต่
  เรียก `connect()` ใหม่หลังหน่วงเวลาแบบ exponential backoff (เริ่ม 1s → 2s → 4s → ...
  จนถึง cap เช่น 30s) พร้อม log ว่า "Connection lost, reconnecting in Xs..."
- backoff delay รีเซ็ตกลับเป็นค่าเริ่มต้น (1s) ทุกครั้งที่ REGISTER สำเร็จ (`201`) — กัน
  ไม่ให้ backoff ยาวขึ้นเรื่อยๆ ข้ามหลายรอบ disconnect ที่ไม่เกี่ยวข้องกัน
- ผูกกับ ADR 0006: ทุกครั้งที่ `connect()` เริ่มรอบใหม่ ให้ reset `seq` กลับเป็น `0` ด้วย

## เหตุผล

1. Node ในสนามจริงเจอ network blip ได้เป็นปกติ — การ exit โปรเซสทันทีเมื่อหลุดครั้งเดียว
   ไม่สมจริงกับโจทย์ IoT sensor node ที่ทำงานอัตโนมัติไม่มีคนเฝ้า
2. Exponential backoff ป้องกัน "reconnect storm" — ถ้า server ล่มจริงๆ หรือกำลัง restart
   node จำนวนมากจะไม่ยิง reconnect พร้อมกันถี่ๆ จนซ้ำเติมปัญหา
3. เป็น demo scenario ที่มีอยู่แล้วในแผนของโปรเจกต์ (ดู `handoff-vmp-project.md` —
   "ungraceful disconnect" เป็นหนึ่งใน 5 test scenario ที่วางแผนไว้) ฟีเจอร์นี้ทำให้
   scenario นั้นมีพฤติกรรมที่ชัดเจนกว่าเดิม ("server ต้อง log และ clean up ไม่ crash"
   ตอนนี้จะกลายเป็น "client ต้องพยายาม reconnect เองได้ด้วย")

## ทางเลือกที่พิจารณาแต่ไม่เลือก

- **ไม่มี reconnect เลย (พฤติกรรมปัจจุบัน)** — เรียบง่ายที่สุด แต่ไม่สมจริงกับ node ที่
  ควรทำงานอัตโนมัติ และทำให้ demo "ungraceful disconnect" จบแค่ "process ตาย" ซึ่งดู
  ไม่ครบถ้วนเทียบกับสิ่งที่โปรเจกต์เคลมว่าเป็น hybrid push/command ระบบสำหรับ sensor
  network จริง
- **Retry ทันทีไม่มี backoff** — ง่ายกว่า exponential backoff เล็กน้อย แต่เสี่ยง
  reconnect storm ถ้า server หายไปนานจริงๆ (เช่นตอน restart เพื่อ demo scenario
  STATUS→401)
