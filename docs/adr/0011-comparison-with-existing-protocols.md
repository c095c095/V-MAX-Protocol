# VMP เทียบกับ MQTT และ CoAP — จุดเด่น จุดอ่อน และเหตุผลของ trade-off แต่ละจุด

> **สถานะ**: เอกสารเปรียบเทียบ — อ้างอิงพฤติกรรมของ ADR 0001–0010 ซึ่งทั้งหมด
> **implement และทดสอบแล้ว** (0009 type-check ผ่านแต่ยังไม่ทดสอบ end-to-end กับ
> version ที่ผิดจริง ดูรายละเอียดในไฟล์นั้น) — "จุดเด่นของ VMP" ด้านล่างจึงอ้างอิง
> พฤติกรรมที่มีอยู่จริงในโค้ด ไม่ใช่แค่แผนบนกระดาษ

VMP ไม่ได้ตั้งใจแข่งกับ MQTT หรือ CoAP ในฐานะโปรโตคอล production สำหรับ IoT จริง —
มันเป็นโปรโตคอลที่ออกแบบใหม่ทั้งหมดสำหรับโจทย์เฉพาะของ assignment นี้: hybrid
push+command บน TCP connection เดียว, ต้อง print ทุกข้อความ/status code แบบ
human-readable, และมี node 3 ประเภทที่ field ข้อมูลต่างกัน อย่างไรก็ตาม MQTT และ CoAP
คือสองโปรโตคอลมาตรฐานที่ถูกออกแบบมาสำหรับ "โจทย์เดียวกัน" (sensor → central server,
telemetry เป็นระยะ + สั่งงานย้อนกลับได้) โดยตรงที่สุด การเทียบกับสองตัวนี้จึงเป็นการเทียบ
กับคู่แข่งที่สมเหตุสมผลที่สุด ไม่ใช่ HTTP/AMQP ที่ไกลจาก domain นี้กว่า

## ตารางเปรียบเทียบ

| แกนเปรียบเทียบ | VMP | MQTT | CoAP |
|---|---|---|---|
| **Transport & delivery guarantee** | TCP ล้วน (ADR 0001) — reliable/in-order ภายใน 1 connection; `Seq` header (ADR 0006) ตรวจจับ gap/duplicate ข้าม reconnect; auto-reconnect พร้อม backoff (ADR 0007) | TCP + QoS ระดับ 0/1/2 ที่ MQTT กำหนดเอง (at-most-once/at-least-once/exactly-once) | UDP เป็นหลัก — reliability ทำเองผ่าน Confirmable/Non-confirmable message ที่ระดับ CoAP เอง ไม่ใช่ transport |
| **Message encoding** | Text-based, HTTP-inspired header + JSON body (ADR 0002) | Binary — fixed header เล็กสุดแค่ 2 byte + variable header + payload เป็น opaque bytes | Binary — fixed header 4 byte, payload มักเป็น CBOR/SenML |
| **Framing** | `Content-Length` แบบ HTTP (ADR 0004) | Remaining-Length field แบบ binary variable-length ใน fixed header | ขอบเขตข้อความ = 1 UDP datagram พอดี ไม่ต้อง frame เพิ่ม |
| **Communication model** | Hybrid: node PUSH เข้า + server ส่ง COMMAND กลับ บน connection เดียวกัน ไม่มี broker กลาง; broadcast ทั้งแปลงผ่าน Plot-ID (ADR 0010) | Pub/sub ผ่าน broker กลาง, decoupled ผู้ส่ง/ผู้รับผ่าน topic hierarchy (รองรับ group addressing โดยธรรมชาติผ่าน topic wildcard) | Request/response แบบ REST (GET/POST/PUT/DELETE); server ส่งกลับหา client ได้ผ่าน Observe extension เท่านั้น |
| **Node/session identity** | REGISTER ผูก Node-ID กับ socket ใน server-side `Map` (ADR 0003); ตรวจสอบ version (ADR 0009) และ `Auth-Token` แบบ shared-secret ทางเลือก (ADR 0008) | Client-ID + broker เก็บ subscription/session state ไว้ (persistent session flag); มี username/password auth ในสเปกอยู่แล้ว | Stateless โดยธรรมชาติ ไม่มี persistent session — จับคู่ request/response ด้วย Token field ต่อ exchange เท่านั้น |
| **Schema flexibility ข้าม node type** | JSON body ต่าง field ได้ตาม node type (Temp/Humid, Soil, Light) โดยไม่ต้องแก้โครงสร้าง header เลย (ADR 0002) | Payload เป็น opaque bytes ทั้งหมด — schema ต้องตกลงกันเองที่ application layer เหมือนกัน ไม่มี built-in structure | เช่นเดียวกับ MQTT — opaque payload, ต้องพึ่ง CBOR/SenML/หรือ convention เองที่ application layer |
| **Human-readability / debuggability** | อ่านออกจาก terminal log ได้ตรงๆ ไม่ต้องมี decoder (ตรงกับข้อบังคับของโจทย์ที่ต้อง print ทุกข้อความ) | Binary — ต้องใช้ tool ถอดรหัส (เช่น mosquitto_sub, Wireshark MQTT dissector) ถึงจะอ่านออก | Binary เช่นกัน — ต้องมี tool ถอดรหัส |
| **Resource footprint / เหมาะกับ constrained device** | JSON + text header หนักกว่า binary protocol ชัดเจน — **จุดอ่อนของ VMP** | Header เล็กสุด 2 byte, ออกแบบมาให้รันบน embedded/battery device ได้จริง | ออกแบบมาสำหรับ constrained node บน 6LoWPAN โดยเฉพาะ (RFC 7252) — เบาที่สุดในสาม |

## ทำไม trade-off ที่ VMP "แพ้" ในตารางถึงยังสมเหตุสมผล

- **JSON/text หนักกว่า binary**: โจทย์บังคับให้ print ข้อความ/status code ทุกอันแบบที่
  มนุษย์อ่านได้ในตอน demo — ถ้าเลือก binary protocol แบบ MQTT/CoAP จะต้องเขียนตัว
  decoder เพิ่มแค่เพื่อ log ให้อ่านออก ซึ่งเพิ่มงานโดยไม่ได้ประโยชน์อะไรกับข้อกำหนดของ
  assignment เลย (ดู ADR 0002)
- **ไม่มี broker/pub-sub แบบ MQTT**: ระบบนี้มี node จำนวนไม่มาก (จำลองในเครื่องเดียว)
  ไม่ใช่ deployment ขนาดใหญ่ที่ต้อง decouple ผู้ส่ง/ผู้รับผ่าน broker กลางจริงๆ — ADR
  0010 แสดงให้เห็นว่า group addressing ทำได้โดยไม่ต้องมี broker เพิ่ม component ใหม่
  เข้าไปในสถาปัตยกรรมเลย
- **ไม่ optimize สำหรับ constrained device**: node ในโปรเจกต์นี้คือ process จำลองบน
  เครื่องคอมพิวเตอร์ทั่วไป ไม่ใช่ microcontroller ที่มี RAM/แบตจำกัดแบบที่ CoAP ถูก
  ออกแบบมารองรับ (6LoWPAN) — การ optimize เรื่องนี้จะแก้ปัญหาที่ assignment ไม่ได้มีอยู่
  จริง

## แนวทางที่พิจารณาแต่ยังไม่ implement (future work)

- **Session resumption แบบเต็มรูปแบบ** — server ออก Session-Token ตอน REGISTER ครั้ง
  แรก แล้ว node ใช้ resume state เดิมได้หลัง reconnect โดยไม่ต้อง REGISTER ใหม่ทั้งหมด
  — ต่อยอดจาก ADR 0006/0007 ได้อีกขั้น แต่ซับซ้อนกว่ามาก (ต้องมี session store,
  expiry, การจัดการ state แยกจาก connection) จึงเลือกยังไม่ทำในรอบนี้
- **Message-ID (UUID) + dedupe** — ทุกข้อความมี unique ID, server เก็บ ID ที่เพิ่งเห็น
  ไว้กันดับเบิล ถ้า client ส่งซ้ำ (เช่นตอน retry หลัง reconnect) จะไม่ประมวลผลซ้ำ — เป็น
  ส่วนขยายที่ทับซ้อนกับสิ่งที่ `Seq` header (ADR 0006) ตรวจจับได้ในระดับหนึ่งแล้ว จึงเลื่อน
  ไปเป็น future work
- **Batch PUSH** — ให้ node ส่งหลาย reading รวมในข้อความเดียว (body เป็น array) ลด
  overhead ต่อข้อความตอน interval สั้นๆ — มีประโยชน์เมื่อ scale ใหญ่ขึ้น แต่ไม่จำเป็นกับ
  จำนวน node ที่ demo ในโปรเจกต์นี้
- **TLS** — encrypt ทั้ง connection จริง แทนที่จะเป็นแค่ shared-secret header (ADR
  0008) — ให้ confidentiality ที่ `Auth-Token` เปล่าๆ ไม่มี แต่เพิ่มความเสี่ยงเรื่อง
  cert/key setup ตอน demo/ตรวจงาน (รายละเอียดอยู่ใน ADR 0008)

## จุดเด่นของ VMP

- **ตรวจจับข้อความหาย/ซ้ำข้าม reconnect ได้ (`Seq` header, ADR 0006)** พร้อม
  **auto-reconnect อัตโนมัติ (ADR 0007)** — MQTT ต้องพึ่ง QoS level ที่ต้อง config เอง
  และ broker ช่วยจัดการ, CoAP ต้องพึ่ง Confirmable message เอง แต่ VMP ทำสิ่งนี้ได้โดย
  ไม่ต้องมี broker หรือเปลี่ยน transport เลย
- **มีชั้นยืนยันตัวตนในตัวโปรโตคอลเอง (`Auth-Token`, ADR 0008)** — เดิม VMP ไม่มี
  auth ใดๆ เลย ตอนนี้ปิดช่องโหว่นี้ได้แบบ backward-compatible โดยไม่บังคับทุกคนต้อง
  ตั้งค่า
- **Version token ที่ validate จริง ไม่ใช่แค่ syntax (ADR 0009)** — เปิดทางให้โปรโตคอล
  วิวัฒนาการต่อได้ในอนาคตแบบมี compatibility gate ชัดเจน
- **Group addressing ทั้งแปลงโดยไม่ต้องมี broker (Plot-ID broadcast COMMAND, ADR
  0010)** — MQTT ทำสิ่งนี้ได้เพราะมี broker + topic hierarchy เป็นโครงสร้างพื้นฐานอยู่
  แล้ว ส่วน CoAP ไม่มีกลไก native สำหรับสิ่งนี้เลย VMP ได้ผลลัพธ์เดียวกันจาก connection
  table ที่มีอยู่แล้วในสถาปัตยกรรม โดยไม่ต้องเพิ่ม component ใหม่
- **อ่านออกจาก terminal log ได้ตรงๆ** โดยไม่ต้องมี decoder ใดๆ เลย — ตรงกับข้อบังคับ
  ของโจทย์ที่ต้อง print ทุกข้อความ ซึ่งเป็นจุดที่ MQTT/CoAP (binary ล้วน) ทำไม่ได้โดยตรง
