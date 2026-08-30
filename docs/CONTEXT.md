# Farm Sensor Network

ระบบ IoT sensor network สำหรับเกษตรกรรม โดย sensor node หลายประเภทกระจายอยู่ตามแปลง ส่งค่าเข้า central server แบบ hybrid (node push ค่าเข้ามาเอง + server สามารถสั่ง node ได้ด้วย) แนวคิดได้แรงบันดาลใจจาก FarmFlow แต่เป็นโปรเจกต์แยกขาด ไม่ผูกกับโค้ด/ระบบจริงของ FarmFlow

## Language

**TempHumidNode**:
Sensor node ที่วัดอุณหภูมิและความชื้นอากาศคู่กัน (เช่นเดียวกับเซนเซอร์จริงอย่าง DHT22)

**SoilNode**:
Sensor node ที่วัดค่า pH ดินและความชื้นดิน

**LightNode**:
Sensor node ที่วัดความเข้มแสง (lux)

## VMP (V MAX Protocol) Methods

**REGISTER**:
Method ที่ node ส่งให้ server ตอนเชื่อมต่อครั้งแรก เพื่อแนะนำตัว (Node-ID, Node-Type, Plot-ID) ก่อนเริ่ม PUSH ได้

**PUSH**:
Method ที่ node ส่งค่าที่วัดได้เข้า server เป็นระยะๆ (node เป็นฝ่ายเริ่มเอง)

**COMMAND**:
Method ที่ server ส่งสั่งงาน node ผ่าน connection เดิมที่ REGISTER ไว้ มี 5 คำสั่งย่อย: SET_INTERVAL (เปลี่ยนความถี่ส่งข้อมูล), REPORT_NOW (สั่งส่งค่าล่าสุดทันที), SET_THRESHOLD (ตั้งขีดจำกัดเตือนภัย เช่น ดินแห้งเกินไปให้ส่ง PUSH ทันที), CALIBRATE (ปรับ offset เซนเซอร์), SHUTDOWN (สั่งตัดการเชื่อมต่อจากระยะไกล)

**STATUS**:
Method ที่ node ส่งเช็คว่ายังลงทะเบียนอยู่กับ server หรือไม่ — body ว่าง มีแค่ header Node-ID ตอบกลับ `200 OK` พร้อม `{"registered": true}` หรือ `401 Unregistered` ถ้า server restart แล้ว state หาย client ส่ง STATUS นี้เองอัตโนมัติทุกๆ 3 ครั้งของ PUSH เป็น self-check เบาๆ (`docs/adr/0012`)
_Avoid_: PING, HEARTBEAT

**UNREGISTER**:
Method ที่ node แจ้ง server ก่อนตัดการเชื่อมต่อ — body ว่าง มีแค่ header Node-ID, server ตอบ `200 OK` แล้วปิด connection ทันที

## VMP Status Codes

**2xx**: `200 OK`, `201 Registered`
**4xx**: `400 BadRequest`, `401 Unregistered`, `403 Forbidden`, `404 NodeNotFound`, `409 DuplicateNode`
**5xx**: `500 InternalError`

> `403 Forbidden` และพฤติกรรมที่เกี่ยวข้องด้านล่าง (`Seq`, `Auth-Token`, version
> validation, Plot-ID broadcast) ออกแบบไว้ใน `docs/adr/0006`–`0010` และ **implement
> แล้ว** ใน `src/server/`, `src/client/`

## VMP Headers เพิ่มเติม (ADR 0006–0010)

**Seq**:
Header จำนวนเต็มบน PUSH/COMMAND เริ่มที่ `1` และ reset ทุกครั้งที่ REGISTER สำเร็จ/
เริ่ม connection ใหม่ — ให้ server ตรวจจับ gap (ข้อความหายช่วง disconnect) หรือ
duplicate ได้ ไม่ใช่ full retransmission layer (`docs/adr/0006`)

**Auth-Token**:
Header ทางเลือกบน REGISTER สำหรับ shared-secret authentication — server เปิดใช้ผ่าน
`--secret <token>` (CLI flag), client ส่งผ่าน `--token <token>` ถ้าไม่ตรงกับ token ที่
server ตั้งไว้ ตอบกลับ `403 Forbidden` ถ้า server ไม่ได้ตั้ง `--secret` ไว้ ไม่มีการเช็คใดๆ
(backward compatible) (`docs/adr/0008`)

**Version validation**:
Server ตรวจสอบว่า start line ของทุก request มี version ตรงกับ `VMP/1.0`
(`VMP_VERSION` ใน `protocol/types.ts`) หรือไม่ ถ้าไม่ตรง ตอบกลับ `400 BadRequest`
(`docs/adr/0009`)

**Plot-ID เป็น COMMAND target ได้**:
Operator REPL ฝั่ง server รองรับ `command <target> <SUBTYPE> [args]` โดย `<target>`
เป็น Plot-ID ก็ได้ (เช่น `PLOT-01`) — server จะส่ง COMMAND เดียวกันไปยังทุก node ที่
ลงทะเบียนอยู่ในแปลงนั้น (log แยกทีละ node) แทนที่จะจำกัดแค่ Node-ID เดี่ยว
(`docs/adr/0010`)

## Naming Conventions

**Plot-ID**:
รหัสระบุแปลง รูปแบบ `PLOT-{เลข 2 หลัก}` เช่น `PLOT-01`
_Avoid_: Field-ID, Zone-ID

**Node-ID**:
รหัสระบุ node เดี่ยว รูปแบบ `{TYPE-PREFIX}-{เลข 2 หลัก}` เช่น `TEMP-01`, `SOIL-01`, `LIGHT-01` — prefix ต้องตรงกับ Node-Type ที่ REGISTER มา (ใช้ validate ได้)

**Timestamp**:
ทุก PUSH body มี field `timestamp` เป็น ISO 8601 พร้อม timezone offset ของกรุงเทพฯ เช่น `2026-08-06T14:30:00+07:00`
