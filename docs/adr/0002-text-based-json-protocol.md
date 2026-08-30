# VMP ใช้ text-based protocol (HTTP-inspired header + JSON body) แทน binary

VMP (V MAX Protocol) เลือกใช้รูปแบบ **text-based**: บรรทัดแรกเป็น command line แบบ HTTP-inspired (เช่น `PUSH VMP/1.0`) ตามด้วย headers (Node-ID, Node-Type, Plot-ID) แล้วปิดท้ายด้วย body เป็น JSON แทนที่จะเป็น binary protocol (fixed-size struct)

เหตุผล:
1. มี 3 node type (TempHumidNode, SoilNode, LightNode) ที่ field ข้อมูลต่างกัน — JSON body ทำให้แต่ละ type ส่ง field ต่างกันได้โดยไม่ต้องแก้โครงสร้าง header
2. Human-readable ทำให้ print message/status ใน terminal (ตามที่โจทย์บังคับ) อ่านง่าย เหมาะกับตอน demo ใน vdo
3. Python มี `json` module ในตัว ลดความเสี่ยงเรื่อง parsing bug เทียบกับ binary struct ที่ต้องนิยาม byte offset เอง

ทางเลือกที่พิจารณาแต่ไม่เลือก: Binary protocol จะเร็วกว่าและโชว์ความเข้าใจ low-level ได้มากกว่า แต่ implement/debug ยากกว่ามาก เสี่ยงเสียเวลากับ byte-alignment bug แทนที่จะโฟกัสกับตัว protocol design
