import Darwin

// flock belongs to the inherited open-file description, retained by Node's fd.
guard flock(3, LOCK_EX) == 0 else { exit(1) }
exit(0)
