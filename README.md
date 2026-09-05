# 📁 Workroom MVP

**Workroom MVP** là ứng dụng web quản lý dự án và công việc (project & task management) được thiết kế tối giản, trực quan, hỗ trợ cộng tác nhóm và quản trị cá nhân.

---

## 🚀 1. Hướng Dẫn Cài Đặt & Chạy Ứng Dụng

### Yêu cầu
- Python 3.8+
- Flask, Werkzeug

```bash
pip install flask werkzeug
```

### Khởi chạy ứng dụng

```bash
python3 server.py
```

Sau đó mở trình duyệt và truy cập:

```
http://localhost:8000
```

> Cơ sở dữ liệu SQLite (`workroom.db`) sẽ tự động được khởi tạo và cấu trúc khi server khởi chạy lần đầu tiên.

---

## 🛠️ 2. Tech Stack & Cấu Trúc Thư Mục

### Tech Stack
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Không phụ thuộc framework phức tạp).
- **Backend**: Python 3 + Flask (REST API).
- **Database**: SQLite (SQL thuần, lưu tại `workroom.db`).

### Cấu Trúc File
```
workroom-mvp/
│
├── server.py        # Web server Flask & REST API routing
├── database.py      # Kết nối SQLite & các hàm thực thi SQL thuần
│
├── index.html       # Trang Đăng nhập & Đăng ký (Auth)
├── workroom.html    # Trang quản lý Project & Task (List, Kanban, Canvas)
│
├── css/
│   └── style.css    # Toàn bộ CSS giao diện
│
├── js/
│   ├── auth.js      # Logic đăng nhập / đăng ký phía client
│   └── workroom.js  # Logic quản lý state, List/Kanban/Canvas & tương tác
│
├── .gitignore       # Cấu hình loại trừ database, cache, file tạm
└── README.md        # Tài liệu hướng dẫn & giải thích hệ thống
```

---

## 🎯 3. Tính Năng Chính
- **Xác thực & Bảo mật**: Đăng ký, đăng nhập với băm mật khẩu Werkzeug, quản lý phiên qua session.
- **Quản lý dự án**: Tạo mới, đổi tên, xóa dự án, chia sẻ dự án qua mã tham gia (Join Code).
- **Quản lý công việc (Tasks)**:
  - Xem dạng Danh sách (List) và Bảng Kanban (kéo thả drag-and-drop).
  - Trạng thái công việc: `Todo`, `Doing`, `Review`, `Done`.
  - Hỗ trợ mô tả chi tiết, ngày hết hạn, quan hệ phụ thuộc (Dependencies), bình luận (Comments) và vị trí Canvas.
- **Tự động di trú schema (Safe Migration)**: Tự động khởi tạo và cập nhật schema mà không làm mất dữ liệu.
