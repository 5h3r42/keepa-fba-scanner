"use client";

import { useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export default function Page() {
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const handleFile = (file: File) => {
    if (file.name.endsWith(".csv")) {
      Papa.parse(file, {
        complete: (results: any) => setRows(results.data),
      });
    } else {
      const reader = new FileReader();

      reader.onload = (e: any) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const json = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
        });

        setRows(json);
      };

      reader.readAsArrayBuffer(file);
    }
  };

  const scanProducts = async () => {
    const asins = rows.map((r) => r[0]).filter(Boolean);
    if (!asins.length) return;

    const res = await fetch(`/api/keepa?asin=${asins.join(",")}`);
    const data = await res.json();

    const enriched = data.products.map((p: any, i: number) => {
      const cost = parseFloat(rows[i]?.[1] || 0);

      const rawPrice = p?.stats?.current?.[1];
      const sellPrice = rawPrice ? rawPrice / 100 : null;

      const prepFee = 0.69;
      const referralFeeRate = 0.15;
      const fbaFulfilment = 3;

      if (!sellPrice) {
        return { ...p, cost, profit: null, roi: null };
      }

      const referralFee = sellPrice * referralFeeRate;
      const totalCost = cost + prepFee + referralFee + fbaFulfilment;

      const profit = sellPrice - totalCost;
      const roi = totalCost ? (profit / totalCost) * 100 : 0;

      return {
        ...p,
        cost,
        sellPrice,
        profit,
        roi,
        referralFee,
        fbaFulfilment,
      };
    });

    setProducts(enriched);
  };

  // ⭐ Export profitable deals
  const exportDeals = async () => {
    const profitable = products.filter((p) => p.roi && p.roi > 30);

    if (!profitable.length) {
      alert("No profitable deals found");
      return;
    }

    await fetch("https://YOUR_WEBHOOK_URL_HERE", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(profitable),
    });

    alert("Deals exported successfully");
  };

  return (
    <main
      style={{
        padding: 40,
        background: "#0f172a",
        minHeight: "100vh",
        color: "white",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 20 }}>
        Amazon FBA ROI Dashboard
      </h1>

      <input
        type="file"
        accept=".csv,.xlsx"
        onChange={(e) => e.target.files && handleFile(e.target.files[0])}
      />

      <br />
      <br />

      <button
        onClick={scanProducts}
        style={{
          padding: "10px 20px",
          background: "#2563eb",
          borderRadius: 6,
          border: "none",
          color: "white",
          cursor: "pointer",
          marginRight: 10,
        }}
      >
        Scan Products
      </button>

      <button
        onClick={exportDeals}
        style={{
          padding: "10px 20px",
          background: "#16a34a",
          borderRadius: 6,
          border: "none",
          color: "white",
          cursor: "pointer",
        }}
      >
        Export Profitable Deals
      </button>

      <table
        style={{
          marginTop: 30,
          width: "100%",
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr style={{ background: "#1e293b" }}>
            <th style={{ padding: 10 }}>Product</th>
            <th>ASIN</th>
            <th>Cost</th>
            <th>Sell Price</th>
            <th>Profit</th>
            <th>ROI</th>
          </tr>
        </thead>

        <tbody>
          {products.map((p, i) => (
            <tr
              key={i}
              style={{
                background:
                  p.roi === null
                    ? "#374151"
                    : p.roi > 30
                      ? "#065f46"
                      : p.roi > 10
                        ? "#78350f"
                        : "#7f1d1d",
              }}
            >
              <td style={{ padding: 10 }}>{p.title}</td>
              <td>{p.asin}</td>
              <td>£{p.cost || 0}</td>
              <td>{p.sellPrice ? `£${p.sellPrice.toFixed(2)}` : "No data"}</td>
              <td>
                {p.profit !== null ? `£${p.profit.toFixed(2)}` : "No data"}
              </td>
              <td>{p.roi !== null ? `${p.roi.toFixed(1)}%` : "No data"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
