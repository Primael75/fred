// Copyright Thales 2026
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

interface PrestonEditorBlockProps {
  presentation_id: string;
  base_url?: string;
}

export function PrestonEditorBlock({ presentation_id, base_url = "http://localhost:5050" }: PrestonEditorBlockProps) {
  return (
    <iframe
      src={`${base_url}/presentation?id=${presentation_id}`}
      style={{ width: "100%", height: "600px", border: "none" }}
      title={`Presenton editor — ${presentation_id}`}
    />
  );
}
