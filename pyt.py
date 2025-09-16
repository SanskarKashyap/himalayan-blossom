from bs4 import BeautifulSoup

# HTML file load karo
with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

soup = BeautifulSoup(html, "lxml")

# Har tag jo text rakhta hai usko check karo
for element in soup.find_all(text=True):
    text = element.strip()
    
    # Skip agar text empty hai ya sirf special chars hain
    if not text or not any(c.isalpha() for c in text):
        continue
    
    parent = element.parent
    
    # Agar parent ke paas pehle se data-en hai to skip
    if parent.has_attr("data-en"):
        continue

    # Clean text
    clean_text = " ".join(text.split())
    
    # Attributes set karo
    parent["data-en"] = clean_text
    parent["data-hi"] = ""   # Hindi translation abhi khali rakho

# Nayi file me save karo
with open("index_updated.html", "w", encoding="utf-8") as f:
    f.write(str(soup))

print("✅ Done! index_updated.html ban gaya with data-en and data-hi attributes.")
