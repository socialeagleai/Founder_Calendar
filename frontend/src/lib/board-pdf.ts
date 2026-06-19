import { jsPDF } from "jspdf";
import { format, parseISO } from "date-fns";

import type { BoardDetail } from "./store";

/** Render a board's details (title, date, and every box) to a downloadable PDF. */
export function downloadBoardPdf(board: BoardDetail) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const newPageIfNeeded = (lineH: number) => {
    if (y + lineH > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Heading
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20);
  doc.text(board.title || "Untitled board", margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(130);
  doc.text(format(parseISO(board.date), "EEEE, d MMMM yyyy"), margin, y);
  y += 26;

  const boxes = [...board.boxes].sort((a, b) => a.y - b.y || a.x - b.x);

  if (boxes.length === 0) {
    doc.setFontSize(12);
    doc.setTextColor(150);
    doc.text("This board has no boxes.", margin, y);
  }

  for (const box of boxes) {
    newPageIfNeeded(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    const titleLines = doc.splitTextToSize(box.title || "Untitled", contentW) as string[];
    for (const line of titleLines) {
      newPageIfNeeded(16);
      doc.text(line, margin, y);
      y += 16;
    }
    y += 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(70);
    if (box.content) {
      const bodyLines = doc.splitTextToSize(box.content, contentW) as string[];
      for (const line of bodyLines) {
        newPageIfNeeded(15);
        doc.text(line, margin, y);
        y += 15;
      }
    }

    // Checklist: each task prefixed with a done/open symbol.
    const tasks = box.tasks ?? [];
    for (const task of tasks) {
      const mark = task.done ? "[x]" : "[ ]";
      const taskLines = doc.splitTextToSize(
        `${mark} ${task.text || ""}`,
        contentW - 12,
      ) as string[];
      taskLines.forEach((line, i) => {
        newPageIfNeeded(15);
        doc.text(line, margin + (i === 0 ? 0 : 16), y);
        y += 15;
      });
    }

    if (!box.content && tasks.length === 0) {
      newPageIfNeeded(15);
      doc.text("-", margin, y);
      y += 15;
    }
    y += 16; // gap between boxes
  }

  const safe = (board.title || "board").replace(/[^\w.-]+/g, "_").slice(0, 60) || "board";
  doc.save(`${safe}.pdf`);
}
