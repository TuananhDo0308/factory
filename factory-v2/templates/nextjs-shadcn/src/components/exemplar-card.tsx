"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface ExemplarCardProps {
  title: string;
  description: string;
}

/** Exemplar component showing clean Factory v2 UI primitives, icons, and state style. */
export function ExemplarCard({ title, description }: ExemplarCardProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </div>
        <Badge variant={acknowledged ? "success" : "secondary"}>
          {acknowledged ? "Ready" : "Starter"}
        </Badge>
      </CardHeader>
      <CardContent>
        <Button
          variant={acknowledged ? "outline" : "default"}
          size="sm"
          onClick={() => setAcknowledged((v) => !v)}
        >
          {acknowledged ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {acknowledged ? "Confirmed" : "Confirm setup"}
        </Button>
      </CardContent>
    </Card>
  );
}
