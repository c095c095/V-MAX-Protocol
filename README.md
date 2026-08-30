# VMP - V MAX Protocol

> **Project 1: Socket Programming**
> Application-Layer Protocol ที่ออกแบบเอง สำหรับระบบ IoT sensor network ในฟาร์ม
> ทำงานบน TCP โดยใช้ Node.js + TypeScript

| | |
|---|---|
| **ชื่อ-นามสกุล** | ศรศิววงศ์ สุขเลิศ |
| **รหัสนิสิต** | 6710405516 |
| **หมู่เรียน** | 1 |
| **รายวิชา** | 01418351 หลักการสื่อสารคอมพิวเตอร์และการประมวลผลบนคลาวด์<br>(Computer Communications and Cloud Computing Principles) |
| **อาจารย์ผู้สอน** | ผศ.ดร. สุขุมาล กิติสิน |

---

## 📦 รายการส่งงาน

| # | สิ่งที่ส่ง | ตำแหน่ง |
|---|---|---|
| 1 | **ไฟล์ PDF** อธิบาย protocol และตอบคำถามข้อ 1 | [`submit/6710405516-VMP-Protocol-Design.pdf`](submit/6710405516-VMP-Protocol-Design.pdf) |
| 2 | **Source code** ของ client และ server | [`src/`](src/) |
| 3 | **VDO Clip** นำเสนอ + demo (≤ 15 นาที) | [`Youtube`](https://youtu.be/qKK-aSk2W7M) |

---

## สารบัญ

1. [VMP คืออะไร](#vmp-คืออะไร)
2. [สรุป Protocol แบบย่อ](#สรุป-protocol-แบบย่อ)
3. [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
4. [วิธีติดตั้งและรัน](#วิธีติดตั้งและรัน)
5. [สถานการณ์ทดสอบ](#สถานการณ์ทดสอบ)
6. [การทดสอบอัตโนมัติ](#การทดสอบอัตโนมัติ)
7. [Dashboard (เครื่องมือช่วย demo)](#dashboard-เครื่องมือช่วย-demo--ไม่ใช่ส่วนที่ส่งตรวจ)
8. [ขอบเขตและข้อจำกัด](#ขอบเขตและข้อจำกัด)
9. [เอกสารอ้างอิง](#เอกสารอ้างอิง)

---

## VMP คืออะไร

**VMP (V MAX Protocol)** เป็น application-layer protocol ที่ออกแบบขึ้นเองสำหรับ **ระบบ IoT sensor
network ในฟาร์ม** - มี sensor node หลายตัวกระจายอยู่ตามแปลงเพาะปลูก คอยวัดค่าสภาพแวดล้อมแล้วส่งเข้า
central server ผ่าน TCP

รองรับ sensor node 3 ประเภท:

| Node Type | Node-ID prefix | ค่าที่วัด (field ใน PUSH body) |
|---|---|---|
| `TempHumidNode` | `TEMP-xx` | `temperature`, `humidity` |
| `SoilNode` | `SOIL-xx` | `soil_ph`, `soil_moisture` |
| `LightNode` | `LIGHT-xx` | `light_intensity` |

**ลักษณะเด่นคือเป็นแบบ hybrid push/command** - node เป็นฝ่ายส่งค่าเข้ามาเอง (`PUSH`) เป็นระยะ ๆ
แต่ server ก็สั่งงานย้อนกลับไปหา node ได้ (`COMMAND`) ผ่าน connection เดิมที่ลงทะเบียนไว้
โดยไม่ต้องให้ node คอย poll ถาม

### ทำไมถึงเลือก TCP ไม่ใช่ UDP

สรุปสั้น ๆ 3 ข้อ (เหตุผลเต็มอยู่ใน PDF และ [`docs/adr/0001-tcp-only-transport.md`](docs/adr/0001-tcp-only-transport.md)):

1. **ต้องการ reliable delivery** - ค่าจาก sensor เป็นข้อมูลที่นำไปตัดสินใจรดน้ำ/ให้ปุ๋ย ข้อมูลหายแล้ว
   ไม่รู้ตัวเป็นปัญหาจริง
2. **ต้องการ connection ที่คงอยู่** เพื่อให้ server ส่ง `COMMAND` ย้อนกลับไปหา node ได้ทันที -
   UDP ไม่มี connection ให้ยึด server จะไม่รู้ว่าจะส่งกลับไปที่ไหน
3. **ต้องการ byte stream ที่เรียงลำดับถูกต้อง** เพราะ message มี header + JSON body ที่ต้องอ่านต่อกัน
   เป็นก้อน (ดู [ADR 0004](docs/adr/0004-content-length-framing.md))

---

## สรุป Protocol แบบย่อ

> รายละเอียดเต็มอยู่ในไฟล์ PDF และ [`docs/CONTEXT.md`](docs/CONTEXT.md) + ADR ทั้ง 12 ฉบับ
> ส่วนนี้เป็นเพียงภาพรวมให้เห็นเร็ว ๆ

### รูปแบบ Message (wire format)

VMP ได้แรงบันดาลใจจาก HTTP - เป็น text-based มี start line + headers + บรรทัดว่าง + JSON body
และใช้ header `Content-Length` เป็นตัวกำหนดขอบเขตของ message (message framing)

```
REQUEST                              RESPONSE
─────────────────────────────        ─────────────────────────────
METHOD VMP/1.0                       VMP/1.0 <code> <phrase>
Header-Name: value                   Header-Name: value
Content-Length: N                    Content-Length: N

<JSON body ขนาด N ไบต์>              <JSON body ขนาด N ไบต์>
```

**ตัวอย่างจริง 1 คู่** - node ลงทะเบียนเข้ากับ server:

```http
REGISTER VMP/1.0
Node-ID: TEMP-01
Node-Type: TempHumidNode
Plot-ID: PLOT-01
Content-Length: 2

{}
```

```http
VMP/1.0 201 Registered
Content-Length: 37

{"message":"Registered successfully"}
```

### Methods ทั้ง 5

| Method | ทิศทาง | หน้าที่ |
|---|---|---|
| `REGISTER` | node → server | แนะนำตัวตอนต่อครั้งแรก (`Node-ID`, `Node-Type`, `Plot-ID`) ก่อนจะ PUSH ได้ |
| `PUSH` | node → server | ส่งค่าที่วัดได้เข้า server เป็นระยะ ๆ (node เริ่มเอง) |
| `COMMAND` | **server → node** | สั่งงาน node ผ่าน connection เดิม |
| `STATUS` | node → server | เช็กว่ายังลงทะเบียนอยู่ไหม - client ส่งเองอัตโนมัติทุก ๆ 3 ครั้งของ PUSH |
| `UNREGISTER` | node → server | แจ้งลาก่อนตัด connection อย่างสุภาพ |

**COMMAND subtypes ทั้ง 5:**

| Subtype | args | ผลที่เกิดกับ node |
|---|---|---|
| `SET_INTERVAL` | `<seconds>` | เปลี่ยนความถี่การ PUSH |
| `REPORT_NOW` | - | สั่งให้ PUSH ค่าล่าสุดทันที |
| `SET_THRESHOLD` | `<field> <min>` | ตั้งค่าขีดเตือน ถ้าค่าต่ำกว่าจะ PUSH ถี่ขึ้น |
| `CALIBRATE` | `<offset>` | ปรับ offset ของเซนเซอร์ |
| `SHUTDOWN` | - | สั่งให้ node ตัดการเชื่อมต่อและปิดตัวเอง |

### Status Codes

ทั้งหมดนิยามรวมไว้ที่เดียวใน [`src/protocol/types.ts`](src/protocol/types.ts) (`STATUS_PHRASES`)

| Code | Phrase | ใช้เมื่อ |
|---|---|---|
| `200` | `OK` | PUSH / STATUS / UNREGISTER / COMMAND สำเร็จ |
| `201` | `Registered` | REGISTER สำเร็จ |
| `400` | `BadRequest` | header ไม่ครบ, `Node-ID` prefix ไม่ตรงกับ `Node-Type`, หรือ version ไม่ใช่ `VMP/1.0` |
| `401` | `Unregistered` | ส่ง PUSH/STATUS ทั้งที่ยังไม่ได้ REGISTER (หรือ server restart จน state หาย) |
| `403` | `Forbidden` | `Auth-Token` ไม่ถูกต้อง (เมื่อ server เปิด `--secret`) |
| `404` | `NodeNotFound` | อ้างถึง node ที่ไม่มีอยู่ |
| `409` | `DuplicateNode` | `Node-ID` นี้ลงทะเบียนไปแล้ว |
| `500` | `InternalError` | ข้อผิดพลาดฝั่ง server |

### Headers เพิ่มเติม

| Header | ใช้กับ | หน้าที่ |
|---|---|---|
| `Seq` | PUSH | เลขลำดับ เริ่มที่ 1 และ reset ทุกครั้งที่ REGISTER ใหม่ - ให้ server ตรวจจับข้อความหาย/ซ้ำได้ ([ADR 0006](docs/adr/0006-sequence-numbers-for-gap-detection.md)) |
| `Auth-Token` | REGISTER | shared secret (ทางเลือก) เปิดใช้ด้วย `--secret` ฝั่ง server ([ADR 0008](docs/adr/0008-auth-token-authentication.md)) |
| `Content-Length` | ทุก message | ขนาด body เป็นไบต์ ใช้ทำ framing ([ADR 0004](docs/adr/0004-content-length-framing.md)) |

---

## โครงสร้างโปรเจกต์

```
.
├── src/
│   ├── protocol/          # wire format ที่ server กับ client ใช้ร่วมกัน
│   │   ├── types.ts       #   constants: VMP_VERSION, STATUS_PHRASES, NODE_TYPE_PREFIX
│   │   └── codec.ts       #   encode/decode + MessageParser (framing) + formatForLog
│   ├── server/
│   │   ├── index.ts       # ★ entry point ของ server - รับ connection, ตรวจ version, dispatch
│   │   ├── handlers.ts    #   handleRegister / handlePush / handleStatus / handleUnregister
│   │   ├── connectionTable.ts  # ตาราง Node-ID -> socket (ใช้ส่ง COMMAND กลับ)
│   │   ├── auth.ts        #   ตรวจ Auth-Token
│   │   └── repl.ts        #   REPL ให้ operator พิมพ์สั่ง COMMAND ได้สด ๆ
│   └── client/
│       ├── index.ts       # ★ entry point ของ client - parse CLI flags, push loop
│       ├── connection.ts  #   socket lifecycle + auto-reconnect (exponential backoff)
│       ├── commands.ts    #   ตอบสนอง COMMAND ทั้ง 5 subtypes
│       └── sensors.ts     #   สุ่มค่าเซนเซอร์ให้สมจริงตามชนิด node
├── tests/                 # ชุดทดสอบอัตโนมัติ 27 tests (npm test)
├── docs/
│   ├── CONTEXT.md         # glossary ของ domain + protocol
│   ├── adr/0001..0012     # บันทึกเหตุผลของทุกการตัดสินใจในการออกแบบ
│   ├── protocol-design.html   # เอกสารอ้างอิงประกอบ (ฉบับที่ใช้ส่งคือ PDF ใน submit/)
│   └── video-script.md    # สคริปต์สำหรับอัดวิดีโอ
├── dashboard/             # เครื่องมือช่วย demo (ไม่ใช่ส่วนที่ส่งตรวจ)
└── submit/                # ไฟล์ที่ส่ง: PDF + สไลด์
```

**หมายเหตุ:** ทั้ง server และ client **พิมพ์ทุก message ที่ส่งและรับ พร้อม status code และ status
phrase** ออกมาทาง console ตามที่โจทย์กำหนด - ดูฟังก์ชัน `formatForLog` ใน
[`src/protocol/codec.ts`](src/protocol/codec.ts) และ `log()` ใน
[`src/server/handlers.ts`](src/server/handlers.ts)

---

## วิธีติดตั้งและรัน

### ความต้องการ

- **Node.js 20 ขึ้นไป** (พัฒนาและทดสอบบน Node.js v24)
- ไม่ต้อง build - รัน TypeScript ตรง ๆ ผ่าน `tsx`

### ติดตั้ง

```bash
npm install
```

### รัน server

```bash
npx tsx src/server/index.ts <port> [--secret <token>]

# ตัวอย่าง
npx tsx src/server/index.ts 4000
```

| อาร์กิวเมนต์ | จำเป็น | ค่าเริ่มต้น | ความหมาย |
|---|---|---|---|
| `<port>` | ไม่ | `4000` | พอร์ตที่ server จะฟัง |
| `--secret <token>` | ไม่ | *(ปิด)* | เปิดโหมดตรวจ `Auth-Token` - client ต้องส่ง `--token` ที่ตรงกัน |

### รัน client (จำลอง sensor node 1 ตัว)

```bash
npx tsx src/client/index.ts --type <NodeType> --id <Node-ID> --plot <Plot-ID> \
    [--host localhost] [--port 4000] [--interval 5] [--token <token>]

# ตัวอย่าง
npx tsx src/client/index.ts --type TempHumidNode --id TEMP-01 --plot PLOT-01 --port 4000 --interval 2
```

| Flag | จำเป็น | ค่าเริ่มต้น | ความหมาย |
|---|---|---|---|
| `--type` | ✅ | - | `TempHumidNode` \| `SoilNode` \| `LightNode` |
| `--id` | ✅ | - | Node-ID - **prefix ต้องตรงกับ type** (`TEMP-` / `SOIL-` / `LIGHT-`) |
| `--plot` | ✅ | - | Plot-ID รูปแบบ `PLOT-xx` |
| `--host` | ไม่ | `localhost` | host ของ server |
| `--port` | ไม่ | `4000` | port ของ server |
| `--interval` | ไม่ | `5` | ส่ง PUSH ทุกกี่วินาที |
| `--token` | ไม่ | - | ใส่เมื่อ server เปิด `--secret` |

กด `Ctrl+C` เพื่อให้ client ส่ง `UNREGISTER` แล้วปิดอย่างสุภาพ

### คำสั่งใน REPL ของ server

หลัง server เริ่มทำงาน จะมี prompt `>` ให้พิมพ์คำสั่งได้ทันที:

```
list                                                   แสดงรายชื่อ node ที่ลงทะเบียนอยู่
command <Node-ID|Plot-ID> SET_INTERVAL <seconds>       เปลี่ยนความถี่การส่งของ node
command <Node-ID|Plot-ID> REPORT_NOW                   สั่งให้ส่งค่าทันที
command <Node-ID|Plot-ID> SET_THRESHOLD <field> <min>  ตั้งค่าขีดเตือน
command <Node-ID|Plot-ID> CALIBRATE <offset>           ปรับ offset เซนเซอร์
command <Node-ID|Plot-ID> SHUTDOWN                     สั่งให้ node ตัดการเชื่อมต่อ
help                                                   แสดงคำสั่งทั้งหมด
```

ถ้า target เป็น **Plot-ID** (เช่น `PLOT-01`) จะเป็นการ **broadcast** คำสั่งเดียวกันไปยังทุก node
ในแปลงนั้น ([ADR 0010](docs/adr/0010-broadcast-command-to-plot.md))

---

## สถานการณ์ทดสอบ

ทุกเคสด้านล่างรันได้จริงและ log ที่แสดงเป็น **output จริงจากการรัน** (ค่าตัวเลขและ timestamp
จะต่างกันไปในแต่ละครั้ง) - เปิด terminal แยกกันตามที่ระบุ

---

### 1️⃣ Happy path - REGISTER → 201 → PUSH → 200

```bash
# Terminal A
npx tsx src/server/index.ts 4000

# Terminal B
npx tsx src/client/index.ts --type TempHumidNode --id TEMP-01 --plot PLOT-01 --port 4000 --interval 2
```

**สิ่งที่ควรเห็นฝั่ง server:**
```
[TEMP-01] <- REGISTER VMP/1.0 | {"Node-ID":"TEMP-01","Node-Type":"TempHumidNode","Plot-ID":"PLOT-01","Content-Length":"2"} | {}
[TEMP-01] -> VMP/1.0 201 Registered | {"Content-Length":"37"} | {"message":"Registered successfully"}
  registered nodes: [TEMP-01]
[TEMP-01] <- PUSH VMP/1.0 | {"Node-ID":"TEMP-01","Seq":"1","Content-Length":"80"} | {"temperature":29.3,"humidity":73.5,"timestamp":"2026-08-30T10:55:50.784+07:00"}
[TEMP-01] -> VMP/1.0 200 OK | {"Content-Length":"40"} | {"message":"Push received successfully"}
```

> 💡 ปล่อยทิ้งไว้สักพัก จะเห็น `STATUS` โผล่มาเองทุก ๆ PUSH ครั้งที่ 3 พร้อมคำตอบ
> `VMP/1.0 200 OK | ... | {"registered":true}` - เป็น self-check ของ client ([ADR 0012](docs/adr/0012-client-periodic-status-heartbeat.md))

---

### 2️⃣ `400 BadRequest` - Node-ID ไม่ตรงกับ Node-Type

```bash
npx tsx src/client/index.ts --type SoilNode --id TEMP-99 --plot PLOT-01 --port 4000
```

**สิ่งที่ควรเห็นฝั่ง client:**
```
<- VMP/1.0 400 BadRequest | {"Content-Length":"69"} | {"message":"Node-ID must start with 'SOIL' for Node-Type 'SoilNode'"}
Registration failed, exiting.
```

---

### 3️⃣ `409 DuplicateNode` - Node-ID ซ้ำกับที่ลงทะเบียนไว้แล้ว

ขณะที่ `TEMP-01` จากเคสที่ 1 ยังรันอยู่ ให้เปิด terminal ที่สามแล้วรัน `TEMP-01` ซ้ำ:

```bash
npx tsx src/client/index.ts --type TempHumidNode --id TEMP-01 --plot PLOT-01 --port 4000
```

**สิ่งที่ควรเห็นฝั่ง client:**
```
<- VMP/1.0 409 DuplicateNode | {"Content-Length":"53"} | {"message":"Node-ID 'TEMP-01' is already registered"}
Registration failed, exiting.
```

---

### 4️⃣ `401 Unregistered` - ส่ง PUSH ก่อน REGISTER

เคสนี้ client ปกติทำไม่ได้ (มันจะ REGISTER ก่อนเสมอ) จึงพิสูจน์ผ่านชุดทดสอบอัตโนมัติแทน:

```bash
npm test   # ดูเคส "PUSH before REGISTER" ใน tests/integration.test.ts
```

**สิ่งที่ควรเห็นฝั่ง server:**
```
[TEMP-01] <- PUSH VMP/1.0 | {"Node-ID":"TEMP-01","Seq":"1","Content-Length":"18"} | {"temperature":30}
[TEMP-01] -> VMP/1.0 401 Unregistered | {"Content-Length":"36"} | {"message":"Node is not registered"}
```

---

### 5️⃣ `403 Forbidden` - Auth-Token ไม่ถูกต้อง

```bash
# Terminal A - server ที่เปิดโหมดตรวจ token
npx tsx src/server/index.ts 4001 --secret farm123

# Terminal B - ไม่ใส่ token → ถูกปฏิเสธ
npx tsx src/client/index.ts --type SoilNode --id SOIL-01 --plot PLOT-02 --port 4001

# Terminal B - ใส่ token ถูกต้อง → ผ่าน
npx tsx src/client/index.ts --type SoilNode --id SOIL-01 --plot PLOT-02 --port 4001 --token farm123
```

**สิ่งที่ควรเห็น (ไม่ใส่ token):**
```
<- VMP/1.0 403 Forbidden | {"Content-Length":"50"} | {"message":"REGISTER requires a valid Auth-Token"}
```

**สิ่งที่ควรเห็น (ใส่ token ถูก):**
```
<- REGISTER VMP/1.0 | {"Node-ID":"SOIL-01",...,"Auth-Token":"farm123","Content-Length":"2"} | {}
<- VMP/1.0 201 Registered | {"Content-Length":"37"} | {"message":"Registered successfully"}
```

---

### 6️⃣ COMMAND ผ่าน REPL + Broadcast ทั้งแปลง

รัน node สองตัวคนละชนิดในแปลงเดียวกัน (`PLOT-01`) แล้วพิมพ์คำสั่งใน terminal ของ server:

```bash
# Terminal B และ C
npx tsx src/client/index.ts --type TempHumidNode --id TEMP-01 --plot PLOT-01 --port 4000 --interval 10
npx tsx src/client/index.ts --type LightNode --id LIGHT-01 --plot PLOT-01 --port 4000 --interval 10

# Terminal A (ที่ prompt ">")
> list
> command PLOT-01 REPORT_NOW
> command TEMP-01 SET_INTERVAL 3
```

**สิ่งที่ควรเห็นฝั่ง server** - คำสั่งเดียวถูกส่งออกไปทั้งสอง node:
```
registered nodes: [LIGHT-01, TEMP-01]
> [LIGHT-01] -> COMMAND {"command":"REPORT_NOW"}
[TEMP-01] -> COMMAND {"command":"REPORT_NOW"}
```

**สิ่งที่ควรเห็นฝั่ง node** (เช่น `TEMP-01` ตอนรับ `SET_INTERVAL`):
```
<- COMMAND VMP/1.0 | {"Node-ID":"TEMP-01","Content-Length":"38"} | {"command":"SET_INTERVAL","seconds":3}
  interval changed to 3s
-> VMP/1.0 200 OK | {"Content-Length":"44"} | {"message":"Command 'SET_INTERVAL' applied"}
```

---

### 7️⃣ Ungraceful disconnect - node ตายกะทันหัน server ต้องไม่ล่ม

ปิด client แบบไม่สุภาพ (ปิดหน้าต่าง terminal ทิ้ง หรือ `kill -9`) แทนการกด `Ctrl+C`

**สิ่งที่ควรเห็นฝั่ง server** - เก็บกวาดเองแล้วทำงานต่อ ไม่ crash:
```
[server] connection closed, removed node 'TEMP-01'
```

---

### 8️⃣ Auto-reconnect - ปิด **server** ทิ้ง แล้วเปิดใหม่

ขณะที่ client กำลัง PUSH อยู่ ให้ปิด **server** (ไม่ใช่ client) แล้วดู log ฝั่ง client

**สิ่งที่ควรเห็นฝั่ง client** - พยายามต่อใหม่แบบ exponential backoff ([ADR 0007](docs/adr/0007-client-auto-reconnect.md)):
```
Connection lost, reconnecting in 1s...
Socket error: connect ECONNREFUSED 127.0.0.1:4000
Connection lost, reconnecting in 2s...
Socket error: connect ECONNREFUSED 127.0.0.1:4000
Connection lost, reconnecting in 4s...
```

เปิด server ขึ้นมาใหม่บนพอร์ตเดิม → client จะ REGISTER ใหม่เองโดยไม่ต้องสั่ง

---

## การทดสอบอัตโนมัติ

```bash
npm test
```

คำสั่งนี้จะทำสองอย่างต่อกัน: `tsc --noEmit` (ตรวจ type ทั้งโปรเจกต์) แล้วรันชุดทดสอบด้วย test
runner ที่มากับ Node.js เอง - **ไม่มี dependency สำหรับทดสอบเพิ่มเลยแม้แต่ตัวเดียว**

```
ℹ tests 27
ℹ pass 27
ℹ fail 0
```

| ไฟล์ | ครอบคลุมอะไร |
|---|---|
| [`tests/protocol.test.ts`](tests/protocol.test.ts) | encode/decode ไป-กลับ, `MessageParser` กับเคสยาก ๆ ของ TCP (message เดียวมาไม่ครบใน 1 chunk, หลาย message มาใน chunk เดียว), `formatForLog` |
| [`tests/integration.test.ts`](tests/integration.test.ts) | **เปิด server จริงแล้วยิงผ่าน TCP socket จริง** - REGISTER/PUSH/STATUS/UNREGISTER, ทุกเคส 4xx, `Auth-Token`, การตรวจจับ `Seq` gap, การตรวจ version, และ REPL รวมถึงการ broadcast ด้วย Plot-ID |

---

## Dashboard (เครื่องมือช่วย demo - ไม่ใช่ส่วนที่ส่งตรวจ)

```bash
npm run dashboard      # เปิดที่ http://127.0.0.1:3000
```

หน้าเว็บสำหรับ **ใช้ประกอบการ demo ในวิดีโอ** - สร้าง/ปิด server หลายตัวคนละพอร์ต สร้าง sensor node
หลายตัว ส่ง COMMAND จากฟอร์ม และดู log ของทุก process พร้อมกันแบบ real-time โดยไม่ต้องสลับ terminal
หลายบาน

> ⚠️ **ขอย้ำว่านี่ไม่ใช่ส่วนหนึ่งของงานที่ส่งตรวจ** และ **ไม่ได้แตะโค้ด protocol เลย** -
> มันทำงานด้วยการ `spawn` process ของ `src/server/index.ts` และ `src/client/index.ts`
> **ตัวจริง ที่ไม่ถูกแก้ไขใด ๆ** แล้วอ่าน stdout ของมันมาแสดงผลเท่านั้น
> (วิธีเดียวกับที่ `tests/integration.test.ts` ทำ) การสื่อสารทั้งหมดที่เห็นบนหน้าเว็บ
> จึงเป็น VMP over TCP ของจริง 100%

**สิ่งที่ demo ผ่าน dashboard ไม่ได้:** การตรวจจับ `Seq` gap และการตรวจ protocol version - ทั้งสอง
อย่างต้องส่ง byte ที่จงใจผิดรูปเข้าไป ซึ่ง client ปกติไม่มีทางส่ง ดูหัวข้อถัดไป

---

## ขอบเขตและข้อจำกัด

**เปิดเผยไว้ตรง ๆ เพื่อความโปร่งใส:**

1. **`Seq` gap detection ([ADR 0006](docs/adr/0006-sequence-numbers-for-gap-detection.md)) และการตรวจ
   protocol version ([ADR 0009](docs/adr/0009-protocol-version-validation.md)) พิสูจน์ได้เฉพาะใน
   `npm test` เท่านั้น** ไม่สามารถ demo สดได้ - เพราะทั้งสองอย่างจะทำงานก็ต่อเมื่อได้รับข้อมูลที่ผิดรูป
   โดยเจตนา ซึ่ง client ที่เขียนถูกต้องไม่มีวันส่งออกไป `tests/integration.test.ts` จึงประกอบ byte
   ขึ้นมาเองเพื่อทดสอบส่วนนี้โดยเฉพาะ **นี่เป็นเรื่องปกติของโค้ดประเภท validation/anomaly detection
   ไม่ใช่ข้อบกพร่องของการออกแบบ**

2. **`Seq` ใช้ตรวจจับ ไม่ใช่ retransmission layer** - VMP บอกได้ว่ามีข้อความหายไประหว่างการ
   reconnect แต่ไม่ได้ขอส่งซ้ำ เพราะค่าจาก sensor ที่เก่าไปแล้วมักไม่มีประโยชน์เท่าค่าปัจจุบัน

3. **ยังไม่มี TLS** - `Auth-Token` เป็น shared secret ที่ส่งไปแบบ plaintext เหมาะกับเครือข่ายภายใน
   ฟาร์มเท่านั้น เหตุผลที่เลื่อน TLS ออกไปอยู่ใน [ADR 0008](docs/adr/0008-auth-token-authentication.md)

4. **สิ่งที่ตั้งใจไม่ทำในเวอร์ชันนี้** - session resumption แบบเต็มรูปแบบ, การกันข้อความซ้ำด้วย
   Message-ID, และ batch PUSH รายละเอียดและเหตุผลอยู่ในหัวข้อ future work ของ
   [ADR 0011](docs/adr/0011-comparison-with-existing-protocols.md)

---

## เอกสารอ้างอิง

### เอกสารหลัก

| ไฟล์ | คืออะไร |
|---|---|
| [`docs/CONTEXT.md`](docs/CONTEXT.md) | glossary ของ domain + protocol ทั้งหมด (node types, methods, status codes, naming convention) |
| [`docs/protocol-design.html`](docs/protocol-design.html) | **เอกสารอ้างอิงประกอบ** - ฉบับที่ใช้ส่งจริงคือไฟล์ PDF ใน `submit/` |
| [`docs/video-script.md`](docs/video-script.md) | สคริปต์และการแบ่งเวลาสำหรับอัดวิดีโอ |

### ADR - บันทึกเหตุผลของทุกการตัดสินใจ

| ADR | หัวข้อ |
|---|---|
| [0001](docs/adr/0001-tcp-only-transport.md) | ทำไมใช้ TCP อย่างเดียว ไม่ใช่ TCP+UDP ผสมกัน |
| [0002](docs/adr/0002-text-based-json-protocol.md) | ทำไมใช้ text-based (header + JSON) ไม่ใช่ binary |
| [0003](docs/adr/0003-nodejs-event-driven-concurrency.md) | โมเดล concurrency แบบ event-driven |
| [0004](docs/adr/0004-content-length-framing.md) | ทำไมใช้ `Content-Length` framing ไม่ใช่ newline-delimited |
| [0005](docs/adr/0005-nodejs-typescript-runtime.md) | ทำไมเลือก Node.js + TypeScript |
| [0006](docs/adr/0006-sequence-numbers-for-gap-detection.md) | `Seq` header สำหรับตรวจจับข้อความหาย/ซ้ำ |
| [0007](docs/adr/0007-client-auto-reconnect.md) | auto-reconnect แบบ exponential backoff |
| [0008](docs/adr/0008-auth-token-authentication.md) | `Auth-Token` shared-secret authentication |
| [0009](docs/adr/0009-protocol-version-validation.md) | การตรวจสอบ protocol version |
| [0010](docs/adr/0010-broadcast-command-to-plot.md) | broadcast COMMAND ไปทั้งแปลงด้วย Plot-ID |
| [0011](docs/adr/0011-comparison-with-existing-protocols.md) | เปรียบเทียบ VMP กับ MQTT / CoAP และจุดเด่นของ VMP |
| [0012](docs/adr/0012-client-periodic-status-heartbeat.md) | ทำไม client ส่ง `STATUS` ทุก ๆ 3 ครั้งของ PUSH |

---

<details>
<summary>🔧 แก้ปัญหาที่อาจเจอ</summary>

**`npm install` แล้วรันไม่ได้ ขึ้น error เกี่ยวกับ esbuild ผิด platform**
เกิดจากการ `npm install` บน Windows แล้วเอา `node_modules` ไปรันบน WSL/Linux (หรือกลับกัน)
วิธีแก้: ลบ `node_modules` ทิ้งแล้ว `npm install` ใหม่บนแพลตฟอร์มที่จะรันจริง

**พอร์ตถูกใช้งานอยู่ (`EADDRINUSE`)**
เปลี่ยนไปใช้พอร์ตอื่น เช่น `npx tsx src/server/index.ts 4010` แล้วให้ client ใส่ `--port 4010` ตาม

</details>
