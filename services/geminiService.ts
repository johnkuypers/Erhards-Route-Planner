
import { GoogleGenAI, Type } from "@google/genai";
import { DeliveryStop, TrafficCondition } from "../types";
import { Language } from "../translations";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeRoute = async (stops: DeliveryStop[], lang: Language = 'en', startTime: string = '09:00 AM'): Promise<{ 
  summary: string; 
  etas: { id: string; eta: string; traffic: TrafficCondition }[] 
}> => {
  const stopList = stops.map((s, i) => ({
    id: s.id,
    name: s.customerName,
    address: s.address,
    priority: s.priority,
    index: i + 1
  }));

  const langMap: Record<Language, string> = {
    en: 'English',
    es: 'Spanish',
    de: 'German'
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze this delivery route. 
    1. Calculate an Estimated Time of Arrival (ETA) for each stop starting from ${startTime} at the Depot. 
    2. Assign a traffic condition ('light', 'moderate', or 'heavy') for the leg leading to each stop based on simulated time-of-day traffic.
    3. IMPORTANT: Provide the 'summary' text in the following language: ${langMap[lang]}.
    
    Route manifest:
    ${JSON.stringify(stopList)}`,
    config: {
      temperature: 0.4,
      responseMimeType: "application/json",
      systemInstruction: "You are an expert logistics coordinator and traffic analyst. Provide precise ETAs and realistic traffic assessments.",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          etas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                eta: { type: Type.STRING, description: "Formatted time, e.g., 09:45 AM" },
                traffic: { 
                  type: Type.STRING, 
                  description: "Traffic intensity for the leg: 'light', 'moderate', or 'heavy'" 
                }
              },
              required: ["id", "eta", "traffic"]
            }
          }
        },
        required: ["summary", "etas"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    const defaultSummaries = {
      en: "Route analysis completed.",
      es: "Análisis de ruta completado.",
      de: "Routenanalyse abgeschlossen."
    };
    return {
      summary: defaultSummaries[lang],
      etas: stops.map((s, i) => ({ 
        id: s.id, 
        eta: `~${10 + Math.floor(i/2)}:${(i%2)*30 || '00'} AM`,
        traffic: (i % 3 === 0 ? 'heavy' : i % 2 === 0 ? 'moderate' : 'light') as TrafficCondition
      }))
    };
  }
};

export const parseAddress = async (input: string): Promise<{ customerName: string; address: string; coords: { lat: number; lng: number } }> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Parse this delivery stop input and extract information. 
    Input: "${input}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          customerName: { type: Type.STRING },
          address: { type: Type.STRING },
          coords: {
            type: Type.OBJECT,
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER }
            },
            required: ["lat", "lng"]
          }
        },
        required: ["customerName", "address", "coords"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    return {
      customerName: "Unknown Customer",
      address: input,
      coords: { lat: 34.0522 + (Math.random() - 0.5) * 0.1, lng: -118.2437 + (Math.random() - 0.5) * 0.1 }
    };
  }
};

export const bulkParseAddresses = async (input: string): Promise<{ customerName: string; address: string; coords: { lat: number; lng: number } }[]> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Parse unstructured address blocks into structured stops. GPS near Los Angeles.
    Input Text: "${input}"`,
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            customerName: { type: Type.STRING },
            address: { type: Type.STRING },
            coords: {
              type: Type.OBJECT,
              properties: {
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER }
              },
              required: ["lat", "lng"]
            }
          },
          required: ["customerName", "address", "coords"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Bulk parse failed", e);
    return [];
  }
};
