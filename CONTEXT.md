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
Method ที่ node ส่งเช็คว่ายังลงทะเบียนอยู่กับ server หรือไม่ — body ว่าง มีแค่ header Node-ID ตอบกลับ `200 OK` พร้อม `{"registered": true}` หรือ `401 Unregistered` ถ้า server restart แล้ว state หาย
_Avoid_: PING, HEARTBEAT

**UNREGISTER**:
Method ที่ node แจ้ง server ก่อนตัดการเชื่อมต่อ — body ว่าง มีแค่ header Node-ID, server ตอบ `200 OK` แล้วปิด connection ทันที

## VMP Status Codes

**2xx**: `200 OK`, `201 Registered`
**4xx**: `400 BadRequest`, `401 Unregistered`, `404 NodeNotFound`, `409 DuplicateNode`
**5xx**: `500 InternalError`

## Naming Conventions

**Plot-ID**:
รหัสระบุแปลง รูปแบบ `PLOT-{เลข 2 หลัก}` เช่น `PLOT-01`
_Avoid_: Field-ID, Zone-ID

**Node-ID**:
รหัสระบุ node เดี่ยว รูปแบบ `{TYPE-PREFIX}-{เลข 2 หลัก}` เช่น `TEMP-01`, `SOIL-01`, `LIGHT-01` — prefix ต้องตรงกับ Node-Type ที่ REGISTER มา (ใช้ validate ได้)

**Timestamp**:
ทุก PUSH body มี field `timestamp` เป็น ISO 8601 พร้อม timezone offset ของกรุงเทพฯ เช่น `2026-08-06T14:30:00+07:00`
