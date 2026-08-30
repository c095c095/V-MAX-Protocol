# VMP ใช้ Content-Length แบบ HTTP กำหนดขอบเขตข้อความ แทน newline-delimited

เพราะ TCP เป็น stream protocol ไม่มีขอบเขตข้อความในตัวเอง VMP ต้องกำหนดวิธี framing ชัดเจน เราเลือก **HTTP-style**: headers คั่นด้วย `\n` แต่ละบรรทัด, บรรทัดว่างคั่นระหว่าง headers กับ body, และ header `Content-Length` บอกจำนวน byte ของ body ก่อนอ่าน body จริง

เหตุผล:
1. แม่นยำ 100% — ไม่มีความเสี่ยงที่ JSON body มี `\n` หลุดเข้ามาแล้วแตกขอบเขตผิดจุด (ต่างจาก newline-delimited JSON ที่เสี่ยงจุดนี้)
2. ต่อยอดจาก header format ที่เป็น HTTP-inspired อยู่แล้ว (ADR 0002) — เทียบเคียงกับสิ่งที่สอนในวิชาได้ตรงๆ
3. Parsing logic ฝั่ง receiver ตรงไปตรงมา: อ่าน header จนเจอบรรทัดว่าง → รู้ Content-Length → อ่าน body ตามจำนวน byte

ทางเลือกที่พิจารณาแต่ไม่เลือก: newline-delimited JSON (ส่ง JSON บรรทัดเดียวจบด้วย `\n`) เขียนง่ายกว่ามาก แต่เสี่ยงพังถ้า JSON string มี `\n` แอบอยู่ข้างใน
