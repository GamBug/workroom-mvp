# 📁 Workroom Mini

**Workroom Mini** là ứng dụng web quản lý dự án và công việc (project & task management) được thiết kế tối giản, trực quan, hỗ trợ cộng tác đa người dùng thời gian thực qua cơ chế revision polling, bảng Kanban tương tác, chế độ Danh sách (List), và Không gian vô cực (Spatial Canvas) với camera pan/zoom, task dependencies, và minimap.

Dự án được xây dựng với triết lý kiến trúc giáo dục: **Vanilla, Framework-free, Clean Separation of Concerns** — không sử dụng frontend build tools hay frameworks nặng nề, mã nguồn được phân tách module rõ ràng, dễ đọc và dễ học.

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
http://127.0.0.1:8000
```

> Cơ sở dữ liệu SQLite (`workroom.db`) sẽ tự động được khởi tạo và di trú cấu trúc (auto-migration) khi server khởi chạy lần đầu tiên mà không làm mất dữ liệu.

---

## 🛠️ 2. Kiến Trúc & Cấu Trúc Thư Mục

```
mini_workroom/
├── backend/
│   ├── __init__.py           # Khởi tạo Python package backend
│   ├── common.py             # Shared decorators (login_required), validators & helpers
│   ├── project_api.py        # Blueprint quản lý Project, Members, Join Code, Exports, Dashboard
│   ├── task_api.py           # Blueprint quản lý Task CRUD & Task Comments
│   └── canvas_api.py         # Blueprint quản lý Spatial Canvas Positions & Task Dependencies
│
├── css/
│   ├── style.css             # Base layout, typography, UI components, Kanban, List, Modals
│   └── canvas.css            # Canvas viewport, transform layer, task nodes, edges, minimap
│
├── js/
│   ├── auth.js               # Logic đăng nhập / đăng ký phía client (Vanilla script)
│   └── workroom/             # Bộ Native ES Modules cho ứng dụng chính
│       ├── core.js           # Single canonical state, API client, toast, modal helpers, filter logic
│       ├── sync.js           # Polling loop, remote synchronization, draft protection, access-loss
│       ├── canvas.js         # Spatial math, camera pan/zoom/fit, node dragging, minimap
│       ├── canvas-graph.js   # Task dependency graph, SVG cubic Bézier curves, drag-to-connect
│       ├── task.js           # Task CRUD, detail modal, Kanban drag-and-drop, List view, comments
│       ├── project.js        # Project CRUD, members, join code, data exports, dashboard
│       └── main.js           # Root entry point, lifecycle bootstrap (initApp), view router
│
├── database.py               # Single SQLite data access layer (SQL thuần, transactions, migrations)
├── server.py                 # Flask server setup, static assets, session config, auth routes
├── index.html                # Trang Đăng nhập & Đăng ký (Auth)
├── workroom.html             # Trang ứng dụng chính (Workspace, Kanban, List, Canvas)
├── .gitignore                # Cấu hình loại trừ SQLite DB, __pycache__, file tạm
└── README.md                 # Tài liệu kiến trúc & hướng dẫn hệ thống
```

---

## 📖 3. Thứ Tự Đọc Mã Nguồn Cho Người Mới Bắt Đầu (Learner Reading Order)

Để nắm bắt toàn bộ luồng kiến trúc mà không bị choáng ngợp bởi mã nguồn lớn, bạn nên đọc các file theo thứ tự gợi ý sau:

1. **`server.py`**: Điểm bắt đầu của ứng dụng backend Flask, xem cấu hình session, cách phục vụ file tĩnh và đăng ký các Blueprints.
2. **`backend/common.py`**: Tìm hiểu decorator `@login_required` và các helper xác thực đầu vào.
3. **`backend/project_api.py`**: Xem các endpoint REST quản lý Project, Dashboard tổng quan, thành viên và mã Join.
4. **`backend/task_api.py`**: Xem các endpoint xử lý Task CRUD và hệ thống bình luận (Comments).
5. **`backend/canvas_api.py`**: Xem cách lưu trữ tọa độ node và mối quan hệ phụ thuộc giữa các công việc (Dependencies).
6. **`database.py`**: File quản trị cơ sở dữ liệu SQLite trung tâm, xem cấu trúc bảng, ràng buộc khóa ngoại và hệ thống `revision` nguyên tử.
7. **`workroom.html`**: Cấu trúc DOM ngữ nghĩa của ứng dụng (Sidebar, Topbar, Canvas viewport, Modals, SVG overlay).
8. **`js/workroom/main.js`**: Điểm nhập (entry point) của frontend, xem quy trình khởi tạo `initApp()` và điều phối chuyển màn hình.
9. **`js/workroom/core.js`**: Trọng tâm state của frontend (`state`), helper HTTP `api`, quản lý thông báo Toast và bộ lọc task.
10. **`js/workroom/project.js`**: Giao diện Dashboard, quản lý danh sách project, thành viên và tính năng export.
11. **`js/workroom/task.js`**: Trực quan hóa Kanban (HTML5 Drag & Drop), bảng List, modal chi tiết công việc.
12. **`js/workroom/sync.js`**: Cơ chế đồng bộ đa người dùng qua chu kỳ revision polling và bảo vệ dữ liệu đang soạn thảo (dirty draft protection).
13. **`js/workroom/canvas.js`**: Không gian Canvas 2D, phép chuyển đổi tọa độ màn hình <-> thế giới thực, camera Pan/Zoom và Minimap tương tác.
14. **`js/workroom/canvas-graph.js`**: Đường cong Bézier bậc 3 (Cubic Bézier) vẽ liên kết dependency và tương tác kéo thả nối node.
15. **`css/style.css` & `css/canvas.css`**: Hệ thống phân tầng giao diện và biến CSS tách biệt giữa UI phẳng và không gian tọa độ.

---

## 🔄 4. Luồng Dữ Liệu & Request Flow (Architecture Flows)

### A. Luồng Cập Nhật Task (Standard Task Request Flow)
```
Người dùng chỉnh sửa Task trong Modal
              ↓
      js/workroom/task.js
              ↓
     PATCH /api/tasks/<id>
              ↓
    backend/task_api.py
              ↓
        database.py
              ↓
          SQLite (Bảng tasks, cập nhật revision của project)
              ↓
       JSON Response (Task mới nhất)
              ↓
 Cập nhật state.tasks trong js/workroom/core.js
              ↓
  Re-render view hiện tại (Kanban / List / Canvas)
```

### B. Luồng Không Gian Canvas & Đồng Bộ Thời Gian Thực (Canvas Spatial Flow)
```
Người dùng kéo thả Task Node trên Canvas
              ↓
      js/workroom/canvas.js (Chuyển đổi pointer screen -> world coordinates)
              ↓
PUT /api/projects/<id>/canvas-positions (Batch update tọa độ)
              ↓
    backend/canvas_api.py
              ↓
        database.py (Bảng task_canvas_positions)
              ↓
 Tăng project revision (+1) trong SQLite
              ↓
 js/workroom/sync.js trên máy client của người dùng khác phát hiện revision mới
              ↓
 syncCurrentProject() tải dữ liệu mới nhất
              ↓
 Node trên Canvas và chấm trên Minimap của máy khác tự động di chuyển
```

### C. Luồng Quan Hệ Phụ Thuộc (Dependency Edge Flow)
```
Kéo điểm nối (Handle) từ Task A sang Task B
              ↓
   js/workroom/canvas-graph.js
              ↓
POST /api/projects/<id>/dependencies (task_id, depends_on_task_id)
              ↓
    backend/canvas_api.py (Kiểm tra self-link, duplicate, chu kỳ)
              ↓
        database.py (Lưu vào bảng task_dependencies)
              ↓
  Tăng project revision (+1)
              ↓
 Đường cong Bézier SVG (<path>) kết nối Task A -> Task B được vẽ tự động
```

---

## 🎯 5. Tính Năng Chi Tiết Trong Hệ Thống

1. **Xác thực & Bảo mật (Auth & Security Baseline)**:
   - Đăng ký, đăng nhập với mật khẩu băm Werkzeug (`generate_password_hash`).
   - Quản lý phiên an toàn qua Flask session (HttpOnly, SameSite).
   - Kiểm tra phân quyền đa tầng (Owner, Member, Outsider) ngăn chặn tấn công IDOR.
2. **Cộng tác & Quản lý Dự án (Projects & Collaboration)**:
   - Tạo mới, đổi tên, xóa dự án (cascade cleanup triệt để).
   - Chia sẻ dự án qua Join Code tiện lợi; quản lý danh sách thành viên và gỡ bỏ thành viên (re-assign task về unassigned).
   - Bảng Dashboard tổng hợp số liệu công việc cần chú ý và tiến độ dự án.
   - Xuất dữ liệu đa định dạng (CSV có Unicode BOM cho Excel và JSON chi tiết).
3. **Quản lý Công việc Đa Chế độ Xem (Tasks & Views)**:
   - **Kanban Board**: Kéo thả HTML5 Drag-and-drop mượt mà giữa các cột `Todo`, `Doing`, `Review`, `Done`.
   - **List View**: Dạng bảng thống kê rõ ràng với hỗ trợ sắp xếp và trạng thái trực quan.
   - **Bộ lọc mạnh mẽ**: Tìm kiếm text, lọc theo trạng thái, lọc hạn chót (quá hạn, hôm nay, tuần này), lọc theo người thực hiện (Assignee) và phím tắt "My Tasks".
4. **Không gian Vô cực (Spatial Canvas)**:
   - Kéo thả node tự do với Pointer Events độc lập với độ phóng đại.
   - Camera Pan (Space + Drag, chuột giữa, Trackpad/Wheel) và Zoom (50% – 200%) neo chính xác theo vị trí con trỏ chuột.
   - Nút Fit Tasks tự động căn giữa và vừa vặn toàn bộ task trong tầm nhìn.
   - Tạo nhanh công việc (Quick Create) bằng cách double-click vào vùng trống của Canvas.
   - **Task Dependencies**: Đường nối có hướng trực quan, tự động điều chỉnh theo chuyển động của task node.
   - **Minimap Tương tác**: Cửa sổ thu nhỏ hiển thị bao quát thế giới Canvas, khung view indicator có thể kéo thả để di chuyển nhanh góc nhìn camera.
5. **Đồng bộ Nhẹ Đa Người Dùng (Revision Synchronization)**:
   - Revision polling định kỳ (3 giây) cực kỳ nhẹ, không gây quá tải server.
   - Cơ chế bảo vệ form đang nhập: Tránh ghi đè khi người dùng đang sửa task hoặc viết bình luận.
   - Tự động tạm dừng polling khi tab trình duyệt ở trạng thái ẩn (`document.hidden`).
