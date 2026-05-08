// skills/codegen.js
export const codegen = {
  name: "codegen",
  description: "Generate RouterOS .rsc code from natural language",
  parameters: {
    prompt: "string - what to generate, e.g. 'block youtube after 8pm'"
  },
  run: async ({prompt}) => {
    const response = await gemini.generate({
      system: "You are a MikroTik RouterOS expert. Output only valid .rsc code.",
      prompt: prompt
    })
    return response.text
  }
}
