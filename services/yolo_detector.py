import sys
import json
from ultralytics import YOLO
import cv2

# Load model once
model = YOLO("services/model/runelite.pt")

image_path = sys.argv[1]

results = model(image_path)[0]

detections = []

for box in results.boxes:
    x1, y1, x2, y2 = box.xyxy[0].tolist()
    cls = int(box.cls[0])
    conf = float(box.conf[0])

    label = results.names[cls]

    detections.append({
        "label": label,
        "confidence": conf,
        "x": int((x1 + x2) / 2),
        "y": int((y1 + y2) / 2),
        "box": [int(x1), int(y1), int(x2), int(y2)]
    })

print(json.dumps(detections))