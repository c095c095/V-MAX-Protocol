# Operator REPL รองรับ `command <Plot-ID> ...` เพื่อ broadcast COMMAND ทั้งแปลง

> **สถานะ**: Implement แล้วใน `src/server/repl.ts` — ทดสอบผ่านแล้วด้วย node 2 ตัว
> (คนละ Node-Type) ใน Plot-ID เดียวกัน ยืนยันว่าทั้งคู่ได้รับ COMMAND เดียวกันและ log
> แยกทีละ node ตามสเปก

หนึ่งแปลง (Plot) มักมี node หลายประเภทพร้อมกัน (TempHumidNode/SoilNode/LightNode) ที่
บ่อยครั้งต้องได้รับคำสั่งเดียวกันพร้อมกัน เช่น "ก่อนพายุเข้า ให้ทุก node ใน PLOT-01 ส่งค่า
ถี่ขึ้น" ปัจจุบันโครงสร้าง REPL ของ operator (`command <Node-ID> <SUBTYPE> [args]`)
รองรับได้แค่ node เดียวต่อคำสั่งเดียว — ถ้าอยากสั่งทั้งแปลงต้องพิมพ์คำสั่งซ้ำทีละ node เอง

เราจึงขยาย `<target>` ของคำสั่ง `command` ให้เป็น **Plot-ID ได้ด้วย** นอกเหนือจาก
Node-ID เดิม

## สเปกที่ต้อง implement

- ใน `server.ts`, REPL handler ของ `command`: เดิม `const node = nodes.get(nodeId)`
  แล้วเช็ค `!node` ให้ error — เปลี่ยนเป็น:
  1. เช็ค `nodes.get(target)` ก่อน (path เดิม, ไม่เปลี่ยนพฤติกรรมถ้า target เป็น
     Node-ID ที่มีจริง)
  2. ถ้าไม่เจอ Node-ID ตรงกัน ให้ไล่หา node ทุกตัวใน `nodes` ที่ `node.plotId ===
     target` — ถ้าเจออย่างน้อย 1 ตัว ให้ส่ง COMMAND เดียวกัน (payload เดียวกันจาก
     `buildCommandPayload`) ไปยังทุก node ที่ match โดย **log การส่งแต่ละครั้งแยกทีละ
     node** (ไม่ใช่ log รวมบรรทัดเดียว) เพื่อให้ยังตรงกับข้อบังคับของโจทย์ที่ต้อง print
     ทุกข้อความที่ส่ง-รับ
  3. ถ้าไม่เจอทั้ง Node-ID และ Plot-ID ที่ตรงกันเลย → แสดง error เดิม (`No such
     registered node or plot: '<target>'`)
- ไม่ต้องแก้ wire format ของ COMMAND message เลย — payload/header ของ COMMAND แต่ละ
  ฉบับที่ส่งออกไปเหมือนเดิมทุกประการ ต่างกันแค่จำนวน socket ที่ส่งออกไป (fan-out จาก
  operator REPL เท่านั้น ไม่ใช่ protocol-level broadcast message ใหม่)
- อัปเดต `printHelp()` ให้มีตัวอย่าง `command <Plot-ID> <SUBTYPE> ...` เพิ่ม

## เหตุผล

1. MQTT ได้ความสามารถนี้มาจาก broker + topic hierarchy (publish ครั้งเดียวไปที่
   `farm/PLOT-01/#` แล้ว subscriber ทุกตัวที่ match topic ได้รับ) — VMP ไม่มี broker
   กลาง แต่ยังทำ group addressing แบบเดียวกันได้ โดยอาศัยข้อมูล `plotId` ที่ server
   เก็บไว้ใน connection table (`Map<NodeID, RegisteredNode>`) อยู่แล้วตั้งแต่ ADR 0003
   — ไม่ต้องเพิ่ม component ใหม่เข้าไปในสถาปัตยกรรมเลย
2. Demo ได้ชัดในวิดีโอ — แสดงให้เห็นว่าแม้ไม่มี broker กลางแบบ MQTT ก็ยังสั่งงานเป็นกลุ่ม
   ได้ ซึ่งเป็นจุดเปรียบเทียบที่ตรงประเด็นกับ MQTT/CoAP โดยตรง (ดู ADR 0011)
3. ความเสี่ยงต่ำมาก — ไม่แตะ wire format, ไม่แตะ client เลย เป็นการเปลี่ยนแค่ dispatch
   logic ฝั่ง operator REPL ของ server เท่านั้น

## ทางเลือกที่พิจารณาแต่ไม่เลือก

**สั่งทีละ node ด้วยมือ (พฤติกรรมปัจจุบัน)** — ใช้งานได้จริงอยู่แล้ววันนี้ ไม่ต้องเพิ่ม
โค้ดเลย แต่ไม่ scale เมื่อจำนวน node ในแปลงเพิ่มขึ้น และไม่สามารถ demo เป็น "สั่งงานเป็น
กลุ่ม" ในวิดีโอได้อย่างน่าประทับใจเท่าการมีคำสั่งเดียวที่ fan-out ให้เอง
