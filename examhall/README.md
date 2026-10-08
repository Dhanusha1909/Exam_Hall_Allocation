# Exam Hall Allocation Tool
1. `npm install`
2. `cp .env.example .env` and paste your MongoDB Atlas URI in MONGODB_URI (empty = in-memory demo mode)
3. `npm start` -> http://localhost:8080

## Allocation inputs and rules
- Register ranges are normal students; comma-separated lateral and transfer register numbers are entered separately. Within each department, normal students are seated before lateral students, then transfer students.
- Each occupied column contains one department. Students from a department may fill a column vertically and can be distributed across halls. Each hall has a configurable maximum number of distinct departments (defaults to 2).
- Each hall can also have a maximum student count, capped at its physical seat count. Leave it blank to use all available seats; blocked seats reduce the actual usable capacity.
- Invigilators are entered as a comma- or newline-separated list. One unique invigilator is assigned to each hall in the order halls are entered; provide at least as many names as halls.
- Under Strict mode, equal subjects and equal departments cannot sit horizontally or diagonally adjacent; vertical neighbors are allowed. With Strict mode off, the relaxed rule applies: only horizontally or diagonally adjacent pairs with both the same department and subject are rejected.
- Once a seating arrangement is generated, use **Hall unusable - Re-allocate** on a hall to exclude it and automatically seat all students in the remaining halls. The existing allocation is kept if the remaining halls cannot fit a valid arrangement. Seat numbers are unique across the active halls. Use **Print seating list** or the floor/hall export buttons to print or download the updated arrangement.

Seats are visited column-wise per hall. Each cohort preserves register order within each student category. The allocator uses backtracking with pruning; blocked and spare seats are supported. An independent verifier re-checks the horizontal and diagonal adjacency rules.

## API contract
The supplied OpenAPI contract is preserved in [openapi.yaml](./openapi.yaml), including all F1, F3, F4, F5, F7, and F8 requirements. Its F7 section also documents this app's configuration, saved-allocation, student seat lookup, hall outage reallocation, and expanded hall/student fields. Contract API errors are JSON objects with a machine-readable `error` code and a human-readable `message`. The default port is 8080 to match the OpenAPI server URL; set `PORT` when the runner provides a different port. CORS is enabled for browser-based contract tools such as Swagger UI.
