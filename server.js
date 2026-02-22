const express = require("express");
const Razorpay = require("razorpay");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const admin = require("firebase-admin");

// ✅ Put your Firebase service account file in this same folder:
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Replace these with your Razorpay keys
const razorpay = new Razorpay({
  key_id: "YOUR_RAZORPAY_KEY_ID",
  key_secret: "YOUR_RAZORPAY_SECRET",
});

// ✅ Replace these with your WhatsApp Cloud API details
const WHATSAPP_PHONE_NUMBER_ID = "YOUR_PHONE_NUMBER_ID";
const WHATSAPP_TOKEN = "YOUR_WHATSAPP_TOKEN";

// ✅ Driver rotation list (edit names later)
const drivers = ["Driver 1", "Driver 2", "Driver 3"];

function pickDriver() {
  return drivers[Math.floor(Math.random() * drivers.length)];
}

// ✅ Pricing logic (base Pasighat). Edit freely.
function getAmountPaise(drop) {
  // default ₹500
  let amount = 50000;

  // Example premium routes:
  if ((drop || "").toLowerCase().includes("tawang")) amount = 1200000; // ₹12,000
  if ((drop || "").toLowerCase().includes("mechuka")) amount = 850000; // ₹8,500
  if ((drop || "").toLowerCase().includes("aalo") || (drop || "").toLowerCase().includes("along")) amount = 650000; // ₹6,500
  if ((drop || "").toLowerCase().includes("dibrugarh")) amount = 800000; // ₹8,000

  return amount;
}

// 1) Create Razorpay order
app.post("/create-order", async (req, res) => {
  try {
    const { drop } = req.body;
    const amount = getAmountPaise(drop);

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: "planb_" + Date.now(),
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "create-order failed", details: String(err) });
  }
});

// 2) Verify payment + update booking + WhatsApp + invoice
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      phone,
      name,
      bookingId, // we'll send this from frontend
    } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", razorpay.key_secret)
      .update(sign)
      .digest("hex");

    if (razorpay_signature !== expected) {
      return res.json({ status: "failure" });
    }

    const assignedDriver = pickDriver();

    // ✅ Update the exact booking in Firebase using bookingId
    if (bookingId) {
      await db.collection("bookings").doc(bookingId).update({
        payment: "Paid",
        status: "Confirmed",
        driver: assignedDriver,
        razorpay_payment_id,
        razorpay_order_id,
      });
    }

    // ✅ WhatsApp to customer (simple text)
    if (phone) {
      await axios.post(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: {
            body: `Hi ${name || ""}, your Plan B Travels booking is CONFIRMED ✅\nDriver: ${assignedDriver}\nPayment ID: ${razorpay_payment_id}`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ✅ Generate invoice PDF locally on server (basic)
    const fileName = `invoice-${razorpay_payment_id}.pdf`;
    const docPDF = new PDFDocument();
    docPDF.pipe(fs.createWriteStream(fileName));
    docPDF.fontSize(18).text("PLAN B TRAVELS - INVOICE", { underline: true });
    docPDF.moveDown();
    docPDF.fontSize(12).text(`Customer: ${name || ""}`);
    docPDF.text(`Phone: ${phone || ""}`);
    docPDF.text(`Payment ID: ${razorpay_payment_id}`);
    docPDF.text(`Order ID: ${razorpay_order_id}`);
    docPDF.text(`Driver: ${assignedDriver}`);
    docPDF.text(`Date: ${new Date().toLocaleString()}`);
    docPDF.end();

    return res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ error: "verify-payment failed", details: String(err) });
  }
});

app.get("/", (req, res) => res.send("PlanB backend is running ✅"));

app.listen(5000, () => console.log("Server running on port 5000 ✅"));
