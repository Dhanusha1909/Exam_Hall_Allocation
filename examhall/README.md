# Exam Hall Allocation Tool
1. `npm install`
2. `cp .env.example .env` and paste your MongoDB Atlas URI in MONGODB_URI (empty = in-memory demo mode)
3. `npm start` -> http://localhost:3000

## Allocation inputs and rules
- Register ranges are normal students; comma-separated lateral and transfer register numbers are entered separately. Within each department, normal students are seated before lateral students, then transfer students.
- Each occupied column contains one department. Students from a department may fill a column vertically and can be distributed across halls. Each hall has a configurable maximum number of distinct departments (defaults to 2).
- Invigilators are entered as a comma- or newline-separated list. One unique invigilator is assigned to each hall in the order halls are entered; provide at least as many names as halls.
- Under Strict mode, equal subjects and equal departments cannot sit horizontally or diagonally adjacent; vertical neighbors are allowed. With Strict mode off, the relaxed rule applies: only horizontally or diagonally adjacent pairs with both the same department and subject are rejected.
- Once a seating arrangement is generated, use **Hall unusable · Re-allocate** on a hall to exclude it and automatically seat all students in the remaining halls. The existing allocation is kept if the remaining halls cannot fit a valid arrangement. Seat numbers are unique across the active halls. Use **Print seating list** or the floor/hall export buttons to print or download the updated arrangement.

Seats are visited column-wise per hall. Each cohort preserves register order within each student category. The allocator uses backtracking with pruning; blocked and spare seats are supported. An independent verifier re-checks the horizontal and diagonal adjacency rules.
