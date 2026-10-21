
import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Suspense fallback={<div>Loading sign up...</div>}>
        <SignUp />
      </Suspense>
    </div>
  );
}
