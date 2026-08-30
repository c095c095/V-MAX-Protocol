# ใช้ TCP ล้วนทั้งระบบ (ไม่ผสม UDP)

ระบบเป็น hybrid architecture (node push ข้อมูลเข้า server + server สั่ง command กลับไปที่ node ได้) ซึ่งโดยทั่วไป IoT sensor telemetry มักเลือกใช้ UDP เพื่อความเร็ว แต่เราเลือก **TCP ล้วนทั้งระบบ** แทน เพราะ:

1. โจทย์ข้อ 3 บังคับให้ print status code/phrase ของทุกข้อความที่ส่ง-รับ — TCP รับประกันข้อความถึงครบ ทำให้ status ที่ print ตรงกับความจริงเสมอ ถ้าใช้ UDP แล้ว packet หาย จะอธิบาย mismatch ยากในรายงาน/vdo
2. Server→node command (เช่น "เปลี่ยนความถี่การส่งข้อมูล") ต้องการความเชื่อถือได้ว่าสั่งถึงจริง
3. ข้อมูล sensor ใช้ตัดสินใจเรื่องรดน้ำ/ให้ปุ๋ย ถือเป็นข้อมูลที่ไม่อยากให้หาย

ทางเลือกที่พิจารณาแต่ไม่เลือก: TCP+UDP ผสม (node→server telemetry ใช้ UDP, server→node command ใช้ TCP) จะโชว์ความเข้าใจ TCP vs UDP ได้ลึกกว่า แต่เพิ่มความซับซ้อนในการ implement (ต้อง handle สอง socket type พร้อมกัน) และมีความเสี่ยงเรื่อง data/status mismatch ตามข้อ 1
